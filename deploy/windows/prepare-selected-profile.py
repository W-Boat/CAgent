"""Build a deployment profile from a validated platform profile and selected knowledge."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('profile', 'knowledge', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.profile / 'manifest.json').read_bytes())
    config_source = next(row for row in manifest['files'] if row['kind'] == 'configuration')
    config_bytes = (args.profile / 'configuration.json').read_bytes()
    if len(config_bytes) != config_source['bytes'] or hashlib.sha256(config_bytes).hexdigest() != config_source['sha256']:
        raise ValueError('Invalid source configuration checksum')
    config = json.loads(config_bytes)
    knowledge = json.loads(args.knowledge.read_bytes())
    config.update({name: knowledge[name] for name in ('bases', 'entries')})
    ids = {base['id'] for base in config['bases']}
    if len(ids) != len(config['bases']) or any(entry['baseId'] not in ids for entry in config['entries']):
        raise ValueError('Invalid selected knowledge references')
    for base in config['bases']:
        if base['connection'] is None:
            del base['connection']
    config['settings'] = [row for row in config['settings'] if not row['key'].startswith('knowledge_shortcuts:')]
    for setting in config['settings']:
        if setting['key'] == 'student_default_theme':
            setting['value'] = 'system'
    args.output.mkdir(parents=True, exist_ok=False)
    files = []

    def save(name, kind, value):
        data = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        (args.output / name).write_bytes(data)
        files.append({'path': name, 'kind': kind, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})

    save('configuration.json', 'configuration', config)
    items = knowledge['items']
    for offset in range(0, len(items), 750):
        save(f'items-{offset // 750 + 1:03d}.json', 'items', items[offset:offset + 750])
    manifest['files'] = files
    manifest['counts'] = {key: len(config[key]) for key in ('settings', 'providers', 'models', 'agents', 'skills', 'bases', 'entries')}
    manifest['counts']['items'] = len(items)
    manifest['selectedKnowledge'] = knowledge['inventory']
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
