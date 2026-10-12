from pathlib import Path
import sys,hashlib,json,shutil
from fontTools.ttLib import TTFont
from fontTools import subset
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);license_file=Path(sys.argv[2]);out=root/'public/fonts';out.mkdir(parents=True,exist_ok=True)
original=TTFont(source);all_codes=set(original.getBestCmap())
text='CAgent 校园智能体平台 欢迎回来 创建账号 校园里的问题，从这里开始。查校园资料找校内地点理清办理流程中国社会科学院大学社科大行知思源宋体登录注册'
core=({ord(c) for c in text}|set(range(32,127)))&all_codes

def ranges(values):
 chunks=[];start=end=None
 for c in sorted(values):
  if end is not None and c==end+1:end=c;continue
  if start is not None:chunks.append(f'U+{start:X}'+(f'-{end:X}' if end!=start else ''))
  start=end=c
 if start is not None:chunks.append(f'U+{start:X}'+(f'-{end:X}' if end!=start else ''))
 return ','.join(chunks)
css=[];files=[]
for kind,codes in [('core',core),('extra',all_codes-core)]:
 font=TTFont(source);options=subset.Options();options.flavor='woff2';options.name_IDs=['*'];worker=subset.Subsetter(options);worker.populate(unicodes=codes);worker.subset(font)
 # OFL reserves the original family name Source: rename the modified subset family.
 names={1:'CAgent Auth Serif',2:'SemiBold',3:'CAgent-Auth-Serif-SemiBold-v1',4:'CAgent Auth Serif SemiBold',6:'CAgentAuthSerif-SemiBold',16:'CAgent Auth Serif',17:'SemiBold'}
 for record in font['name'].names:
  if record.nameID in names:record.string=names[record.nameID].encode(record.getEncoding())
 if 'CFF ' in font:
  cff=font['CFF '].cff;cff.fontNames=['CAgentAuthSerif-SemiBold'];cff.topDictIndex[0].FamilyName='CAgent Auth Serif';cff.topDictIndex[0].FullName='CAgent Auth Serif SemiBold'
 font.flavor='woff2';temp=out/f'auth-serif-{kind}.woff2';font.save(temp);data=temp.read_bytes();digest=hashlib.sha256(data).hexdigest();name=f'auth-serif-{kind}-{digest[:12]}.woff2';temp.rename(out/name)
 files.append({'file':name,'bytes':len(data),'glyphCodepoints':len(codes),'sha256':digest})
 css.append('@font-face{font-family:"CAgent Auth Serif";src:url("/fonts/'+name+'") format("woff2");font-style:normal;font-weight:600;font-display:swap;unicode-range:'+ranges(codes)+'}')
css.append('.auth-page .brand h1,.auth-page .form-title,.auth-page .auth-intro h2{font-family:"CAgent Auth Serif","Source Han Serif SC","思源宋体","Songti SC",SimSun,serif;font-weight:600;letter-spacing:0}')
(root/'src/styles/auth-typography.css').write_text('\n'.join(css)+'\n',encoding='utf-8',newline='\n');shutil.copy2(license_file,out/'AUTH-SERIF-OFL.txt')
meta={'source':'https://github.com/adobe-fonts/source-han-serif','version':'2.003R','original':'SourceHanSerifCN-SemiBold.otf','originalSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'modifiedFamily':'CAgent Auth Serif','license':'SIL OFL 1.1; renamed derivative subsets','loading':'Core auth titles and ASCII subset; complementary glyph subset only requested for characters absent from core. Font display swap, auth route CSS only.','files':files}
(out/'AUTH-SERIF.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(meta,ensure_ascii=False))
