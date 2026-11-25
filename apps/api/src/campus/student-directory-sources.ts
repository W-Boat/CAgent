export const academicCalendarIndex = 'https://jw.ucass.edu.cn/jxrl.htm'
export const academicCalendarPortal = 'https://app.ucass.edu.cn/wap/material?id=7'
export const campusDepartments = 'https://www.ucass.edu.cn/xxgk1/zzjg.htm'

type Office = [label:string, numbers:string[]]
type ContactSource = {department:string; url:string; offices:Office[]}
type AcademicNotice = {key:string; title:string; date:string; url:string; evidence:RegExp; answer:string}

export const contactSources: ContactSource[] = []
export const academicNotices: AcademicNotice[] = []
