export const academicCalendarIndex = process.env.CAMPUS_CALENDAR_INDEX_URL || 'https://campus.example.invalid/calendar'
export const academicCalendarPortal = process.env.CAMPUS_CALENDAR_PORTAL_URL || academicCalendarIndex
export const campusDepartments = process.env.CAMPUS_DIRECTORY_URL || 'https://campus.example.invalid/directory'

type Office = [label:string, numbers:string[]]
type ContactSource = {department:string; url:string; offices:Office[]}
type AcademicNotice = {key:string; title:string; date:string; url:string; evidence:RegExp; answer:string}

export const contactSources: ContactSource[] = []
export const academicNotices: AcademicNotice[] = []
