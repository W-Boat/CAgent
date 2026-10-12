import {get,post,patch,del} from './client'
export interface CaptureRow {courseNo:string;name:string;section:string;arrangement:string;teachingMethod:string}
export interface TimetableCapture {semester:string;rows:CaptureRow[]}
export interface Meeting {weeks:number[];weekday:number;start:string;end:string;location:string;teacher:string}
export interface TimetableCourse extends CaptureRow {meetings:Meeting[];warnings:string[]}
export interface TimetableProfile {semester:string;courses:TimetableCourse[];warnings:string[];semesterStart:string|null;campus:string;useInChat:boolean;remindersEnabled:boolean;reminderLeadMinutes:number;updatedAt:string}
export interface TimetableEvent {id:string;name:string;date:string;week:number;weekday:number;start:string;end:string;startsAt:string;endsAt:string;location:string;teacher:string;mapUrl:string|null}
export interface Upcoming {configured:boolean;date:string;events:TimetableEvent[];remindersEnabled:boolean;reminderLeadMinutes:number}
export interface TimetableBrowserFrame {image:string;width:number;height:number;pagePath:string;expiresAt:string}
export const timetableApi={
  startBrowser:()=>post<TimetableBrowserFrame&{id:string}>('/timetable/browser'),
  browserFrame:(id:string)=>get<TimetableBrowserFrame>(`/timetable/browser/${id}/frame`),
  browserAction:(id:string,data:{action:string;x?:number;y?:number;text?:string;key?:string;delta?:number})=>post<TimetableBrowserFrame>(`/timetable/browser/${id}/action`,data),
  browserCapture:(id:string)=>post<{capture:TimetableCapture;preview:Pick<TimetableProfile,'semester'|'courses'|'warnings'>}>(`/timetable/browser/${id}/capture`),
  closeBrowser:(id:string)=>del(`/timetable/browser/${id}`),
  closeAllBrowsers:()=>del('/timetable/browser'),
  get:()=>get<TimetableProfile|null>('/timetable'),
  preview:(capture:TimetableCapture)=>post<Pick<TimetableProfile,'semester'|'courses'|'warnings'>>('/timetable/preview',capture),
  save:(capture:TimetableCapture)=>post<TimetableProfile>('/timetable',capture),
  preferences:(data:Pick<TimetableProfile,'semesterStart'|'campus'|'useInChat'|'remindersEnabled'|'reminderLeadMinutes'>)=>patch<TimetableProfile>('/timetable/preferences',data),
  upcoming:()=>get<Upcoming>('/timetable/upcoming'),
  calendar:()=>get<{filename:string;content:string}>('/timetable/calendar'),
  remove:()=>del('/timetable')
}
