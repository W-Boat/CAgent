"""Build the offline Windows bundle from explicit binaries and private data sources."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('build', 'node', 'postgres', 'profile', 'maps', 'map-data', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--lectures', type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    repo = source.parent.parent
    archive_root = 'CAgent'

    def retain(member):
        name = Path(member.name).name
        if name in {'.cache', '.git', '.npmrc', '.env'} or re.search(r'\.tmp\d*$', name):
            return None
        if not (member.isdir() or member.isfile() or member.islnk()):
            raise ValueError(f'Nonportable file: {member.name}')
        return member

    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((args.profile / 'manifest.json').read_text(encoding='utf-8-sig'))
    payload_files = []
    for member in manifest['files']:
        filename = member['path']
        if not re.fullmatch(r'configuration\.json|items-[a-z0-9-]+\.json', filename):
            raise ValueError(f'Unexpected campus profile member: {filename}')
        data = (args.profile / filename).read_bytes()
        if len(data) != member['bytes'] or hashlib.sha256(data).hexdigest() != member['sha256']:
            raise ValueError(f'Campus profile checksum mismatch: {filename}')
        payload_files.append(filename)
    temporary = args.output.with_name(args.output.name + '.partial')
    try:
        with tarfile.open(temporary, 'w:gz', compresslevel=3, format=tarfile.PAX_FORMAT) as tar:
            def add(file, dest, *, recursive=True):
                if not file.exists():
                    raise FileNotFoundError(file)
                tar.add(file, f'{archive_root}/{dest}', recursive=recursive, filter=retain)

            for filename in ('Deploy.cmd', 'Install.ps1', 'Start.ps1', 'Stop.ps1', 'Protect-Keys.ps1', 'Register-Startup.ps1', 'runtime.cjs', 'setup.cjs', 'start.cjs',
                             'run.cjs', 'keys.cjs', 'provider-keys.example.json', '部署说明.md'):
                add(source / filename, filename)
            add(args.node, 'runtime/node/node.exe')
            for name in ('bin', 'lib', 'share'):
                add(args.postgres / name, 'runtime/pgsql/' + name)
            for file in ('COPYRIGHT', 'LICENSE', 'LICENSE.txt'):
                if (args.postgres / file).is_file():
                    add(args.postgres / file, 'runtime/pgsql/' + file)
            for file in ('LICENSE', 'LICENSE.txt'):
                if (args.node.parent / file).is_file():
                    add(args.node.parent / file, 'runtime/node/' + file)
            for child in sorted((args.build / 'api').iterdir()):
                if child.name == 'src':
                    for module in sorted(child.iterdir()):
                        arc = 'apps/api/dist/src/' + module.name
                        if module.name == 'campus':
                            for item in sorted(module.iterdir()):
                                if item.name != 'campus-maps.data.json':
                                    add(item, arc + '/' + item.name)
                            add(args.map_data, arc + '/campus-maps.data.json')
                        else:
                            add(module, arc)
                elif child.is_dir():
                    add(child, 'apps/api/dist/' + child.name)
            for filename in ('package.json', 'prisma/schema.prisma', 'scripts/import-campus-profile.mjs', 'scripts/lib/campus-profile.mjs', 'scripts/import-lectures.cjs'):
                add(repo / 'apps/api' / filename, 'apps/api/' + filename)
            add(repo / 'apps/api/node_modules', 'apps/api/node_modules')
            for child in sorted((args.build / 'web').iterdir()):
                if child.name != 'maps':
                    add(child, 'apps/web/dist/' + child.name)
            maps = json.loads(args.map_data.read_bytes())
            for campus in maps['campuses']:
                match = re.fullmatch(r'/maps/([a-zA-Z0-9][a-zA-Z0-9._-]+)', campus['imageUrl'])
                if not match:
                    raise ValueError('Map image must use a bundled static path')
                filename = match[1]
                add(args.maps / filename, 'apps/web/dist/maps/' + filename)
            add(args.profile / 'manifest.json', 'payload/profile/manifest.json')
            for filename in payload_files:
                add(args.profile / filename, 'payload/profile/' + filename)
            if args.lectures:
                add(args.lectures, 'payload/lectures.json')
        temporary.replace(args.output)
    finally:
        if temporary.exists():
            temporary.unlink()
    with args.output.open('rb') as file:
        checksum = hashlib.file_digest(file, 'sha256').hexdigest()
    args.output.with_name(args.output.name + '.sha256').write_text(f'{checksum}  {args.output.name}\n', encoding='ascii')
    print(f'{args.output} ({args.output.stat().st_size:,} bytes)')
    print(f'SHA256 {checksum}')


if __name__ == '__main__':
    main()
