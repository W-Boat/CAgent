/** Self-contained: Chrome serializes it into all frames of a whitelisted UT tab. */
export function extractTimetable(){
  if(location.origin!=='https://ut.ucass.edu.cn'||location.pathname!=='/Student/CourseTimetable/MyCourseTimeTable.aspx')return null
  const clean=s=>(s||'').normalize('NFKC').replace(/\s+/g,' ').trim()
  const form=document.querySelector('form#ctl01')
  if(!form)return null
  const semester=[...form.querySelectorAll('select')].map(s=>clean(s.selectedOptions[0]?.textContent)).find(s=>/^20\d{2}-20\d{2}学年[第]?[一二三123]学期$/.test(s))
  if(!semester)return null
  const headers=['课程号','课程名','课序号','上课安排','教学方式']
  for(const table of form.querySelectorAll('table')){
    const lines=[...table.rows]
    const header=lines.find(row=>headers.every(name=>[...row.cells].some(c=>clean(c.innerText)===name)))
    if(!header)continue
    const cols=headers.map(name=>[...header.cells].findIndex(c=>clean(c.innerText)===name)),rows=[]
    for(const row of lines.slice(lines.indexOf(header)+1)){
      if(row.cells.length<=Math.max(...cols))continue
      const fields=cols.map(i=>clean(row.cells[i].innerText))
      if(!fields[1]||!fields[3]||fields[0]==='课程号')continue
      if(rows.length>=120)throw new Error('课表超过 120 门课程，请检查页面')
      if(fields.some((f,i)=>f.length>(i===3?4000:200)))throw new Error('课表字段超长，请检查页面')
      rows.push({courseNo:fields[0],name:fields[1],section:fields[2],arrangement:fields[3],teachingMethod:fields[4]})
    }
    if(rows.length)return {capture:{semester,rows}}
  }
  return null
}
