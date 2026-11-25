"""Build a Windows offline upgrade for an existing CAgent installation."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('build', 'database-delta', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent
    root = 'CAgent_Offline_Update'
    manifest = {'format': 'cagent-offline-update-v1', 'files': []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.zip.partial')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for app in ('api', 'web'):
                folder = args.build / app
                for file in sorted(folder.rglob('*')):
                    if not file.is_file() or file.is_symlink():
                        continue
                    name = file.relative_to(folder).as_posix()
                    if name.startswith('maps/') or name == 'src/campus/campus-maps.data.json' or name.endswith(('.map', '.tsbuildinfo')):
                        continue
                    destination = f'{app}/{name}'
                    content = file.read_bytes()
                    manifest['files'].append({'path': destination, 'sha256': hashlib.sha256(content).hexdigest()})
                    archive.writestr(f'{root}/payload/{destination}', content)
            paths = {item['path'] for item in manifest['files']}
            if not {'api/src/main.js', 'api/src/settings/platform-backup.service.js', 'web/index.html'} <= paths:
                raise ValueError('The current build is incomplete')
            archive.writestr(f'{root}/app-manifest.json', json.dumps(manifest, separators=(',', ':')))
            for name in ('Update-App.ps1', '离线更新说明.md'):
                archive.write(scripts / name, f'{root}/{name}')
            with zipfile.ZipFile(args.database_delta) as delta:
                for name in ('Update-Database.cmd', 'Update-Database.ps1', 'update.cjs', 'manifest.json', 'delta.json.gz', '数据库增量更新说明.md'):
                    archive.writestr(f'{root}/database-delta/{name}', delta.read('CAgent_Database_Delta/' + name))
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)
    with args.output.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    args.output.with_suffix('.zip.sha256').write_text(f'{digest}  {args.output.name}\n', encoding='ascii')
    print(f'{args.output.name}: {args.output.stat().st_size:,} bytes, {len(paths)} app files, SHA256 {digest}')


if __name__ == '__main__':
    main()
