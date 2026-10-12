/** Serialized into the academic frame by Playwright. No external references or page-wide extraction. */
export function extractAcademicTimetable(){
  if(location.origin!=='https://ut.ucass.edu.cn'||location.pathname!=='/Student/CourseTimetable/MyCourseTimeTable.aspx')return null
  const clean=(s:string|null)=>(s||'').normalize('NFKC').replace(/\s+/g,' ').trim()
  const form=document.querySelector('form#ctl01');if(!form)return null
  const semester=Array.from(form.querySelectorAll('select')).map(s=>clean(s.selectedOptions[0]?.textContent)).find(s=>/^20\d{2}-20\d{2}学年[第]?[一二三123]学期$/.test(s))
  if(!semester)return null
  const headers=['课程号','课程名','课序号','上课安排','教学方式']
  for(const table of Array.from(form.querySelectorAll('table'))){
    const lines=Array.from(table.rows),header=lines.find(row=>headers.every(name=>Array.from(row.cells).some(c=>clean(c.innerText)===name)))
    if(!header)continue
    const cols=headers.map(name=>Array.from(header.cells).findIndex(c=>clean(c.innerText)===name)),rows:Array<{courseNo:string;name:string;section:string;arrangement:string;teachingMethod:string}>=[]
    for(const row of lines.slice(lines.indexOf(header)+1)){
      if(row.cells.length<=Math.max(...cols))continue
      const f=cols.map(i=>clean(row.cells[i].innerText));if(!f[1]||!f[3]||f[0]==='课程号')continue
      if(rows.length>=120||f.some((v,i)=>v.length>(i===3?4000:200)))throw new Error('课表大小超过限制')
      rows.push({courseNo:f[0],name:f[1],section:f[2],arrangement:f[3],teachingMethod:f[4]})
    }
    if(rows.length)return {semester,rows}
  }
  return null
}
