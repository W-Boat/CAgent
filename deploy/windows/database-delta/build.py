"""Package the campus incremental knowledge datasets without site settings or credentials."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import unicodedata
import zipfile


ROOT = 'CAgent_Database_Delta'
FILES = {
    'collective-timetable': ['items-collective-timetable.json'],
    'lectures': ['items-update-20261030-001.json', 'items-update-20261030-002.json'],
}


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def write_package(output, payload, manifest):
    source_dir = Path(__file__).resolve().parent
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + '.partial')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            for name in ('Update-Database.cmd', 'Update-Database.ps1', 'update.cjs', '数据库增量更新说明.md'):
                package.write(source_dir / name, ROOT + '/' + name)
            package.writestr(ROOT + '/manifest.json', json_bytes(manifest))
            package.writestr(ROOT + '/delta.json.gz', payload, compress_type=zipfile.ZIP_STORED)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    with output.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    print(json.dumps({'bytes': output.stat().st_size, **manifest}, ensure_ascii=True))


def build_selection(knowledge_path, output):
    knowledge = json.loads(knowledge_path.read_bytes())
    bases = knowledge['bases']
    sources = []
    by_embedded_key = {}
    for base in bases:
        if base['kind'] not in {'LOCAL', 'EMBEDDED'}:
            raise ValueError('Only portable knowledge bases may be included')
        source = {key: base[key] for key in ('id', 'name', 'description', 'kind', 'mounted')}
        source['key'] = base['id']
        if base.get('connection'):
            source['connection'] = base['connection']
        if base['kind'] == 'EMBEDDED':
            by_embedded_key[base['connection']['sourceKey']] = base['id']
        sources.append(source)

    def embedded_key(row):
        kb = (row.get('extra') or {}).get('kb') or {}
        collection, file = kb.get('collection'), kb.get('file')
        if collection == 'freshman':
            return 'handbooks/freshman-2026'
        if collection == 'campus-v2-contest':
            return 'campus-v2-contest/database/campus.sqlite' if file == 'database/campus.sqlite' else 'campus-v2-contest/knowledge'
        return file or 'legacy/guide_v4.json'

    counts = {source['key']: 0 for source in sources}
    guide, entries = [], []
    for row in knowledge['items']:
        key = by_embedded_key[embedded_key(row)]
        counts[key] += 1
        guide.append({**row, 'deltaSource': key})
    for row in knowledge['entries']:
        counts[row['baseId']] += 1
        entries.append({key: value for key, value in row.items() if key != 'id'})
    if counts != {row['id']: row['count'] for row in knowledge['inventory']}:
        raise ValueError('Selected snapshot counts do not match')
    payload = gzip.compress(json_bytes({'sources': sources, 'guide': guide, 'entries': entries}), compresslevel=6, mtime=0)
    write_package(output, payload, {'format': 'cagent-database-delta-v2', 'sha256': checksum(payload), 'counts': counts})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=Path)
    parser.add_argument('--portal-module', type=Path)
    parser.add_argument('--knowledge', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.knowledge:
        if args.profile or args.portal_module:
            parser.error('--knowledge is independent of the legacy profile options')
        return build_selection(args.knowledge, args.output)
    if not args.profile or not args.portal_module:
        parser.error('use --knowledge or provide both --profile and --portal-module')
    profile = json.loads((args.profile / 'manifest.json').read_bytes())
    descriptors = {row['path']: row for row in profile['files']}

    def read(name):
        data = (args.profile / name).read_bytes()
        expected = descriptors[name]
        if len(data) != expected['bytes'] or checksum(data) != expected['sha256']:
            raise ValueError(f'Source checksum mismatch: {name}')
        return json.loads(data)

    source_config = read('configuration.json')['bases']
    sources, guide = [], []
    for collection, names in FILES.items():
        rows = [row for name in names for row in read(name)]
        if not rows or any(row['extra']['kb']['collection'] != collection for row in rows):
            raise ValueError(f'Unexpected dataset collection: {collection}')
        source_keys = {row['extra']['kb']['file'] for row in rows}
        matching = [base for base in source_config if (base.get('connection') or {}).get('sourceKey') in source_keys]
        if len(matching) != 1 or len(source_keys) != 1 or matching[0]['kind'] != 'EMBEDDED':
            raise ValueError(f'Invalid knowledge source registration: {collection}')
        base = matching[0]
        # Copy only the source ID and public descriptive fields; no host-specific settings.
        sources.append({
            'key': collection, 'id': base['id'], 'name': base['name'], 'description': base['description'],
            'kind': 'EMBEDDED', 'mounted': True,
            'connection': {'sourceKey': next(iter(source_keys)), 'collections': [collection], 'readOnly': True},
        })
        guide.extend(rows)

    portal = json.loads(subprocess.check_output(['node', '-e', 'console.log(JSON.stringify(require(process.argv[1])))', str(args.portal_module.resolve())]))
    sources.append({
        'key': 'portal-navigation', 'id': portal['portalNavigationBase'], 'kind': 'LOCAL', 'mounted': True,
        'name': '官方门户入口与办理导航', 'description': '通用校园应用入口和学生办事路径。',
        'connection': {'observedAt': portal['portalNavigationObservedAt'], 'taxonomy': {'entryPrefix': 'ucass-portal-nav:', 'topics': [
            {'key': 'apps', 'label': '校园应用'}, {'key': 'services', 'label': '学生事务'}]}},
    })
    entries = []
    for entry in portal['portalNavigation']:
        title = entry['title']
        normalized = ''.join(ch for ch in unicodedata.normalize('NFKC', title).lower()
                             if not ch.isspace() and ch not in '\u200b\u200c\u200d\ufeff'
                             and (unicodedata.category(ch)[0] not in 'PS' or ch in '+-*/%=<>¥￥$'))
        entries.append({**entry, 'question': title, 'questionKey': checksum(normalized.encode('utf-8')),
                        'source': '学校官方门户 · ' + portal['portalNavigationObservedAt'], 'mode': 'RAG', 'status': 'APPROVED',
                        'summary': entry['answer']})

    payload = gzip.compress(json_bytes({'sources': sources, 'guide': guide, 'entries': entries}), compresslevel=6, mtime=0)
    manifest = {
        'format': 'cagent-database-delta-v1', 'sha256': checksum(payload),
        'counts': {source['key']: len(entries) if source['kind'] == 'LOCAL' else sum(row['extra']['kb']['collection'] == source['key'] for row in guide) for source in sources},
        'sourceSnapshots': {'knowledge': profile['exportedAt'], 'portal': portal['portalNavigationObservedAt']},
    }
    write_package(args.output, payload, manifest)


if __name__ == '__main__':
    main()
