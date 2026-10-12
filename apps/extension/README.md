# CAgent 课表助手 2.0

在 Chrome / Edge 扩展页面开启开发者模式，加载解压目录。登录 https://ut.ucass.edu.cn/Navigation/Default.htm，打开「我的课表」，选择学期并确定，回到平台 /timetable 点击读取。

仅提取 https://ut.ucass.edu.cn/Student/CourseTimetable/MyCourseTimeTable.aspx 中 form#ctl01 下的五列可见表格，支持 iframe#divFrame4。提取选择的学期、课程号、课程名、课序号、上课安排、教学方式。平台先显示解析预览，确认后才保存到当前账号的私有课表。

无 Cookie、密码、完整 HTML、截图、调试器、任意脚本、命令队列或全站权限；不保存平台访问令牌。旧版通用浏览器助手已替换。生产只允许 campus.example.org/timetable 发起读取；localhost 的 5173 / 4173 用于本地开发。

应用内置浏览器和手机浏览器不能安装此扩展，可使用电脑导入后查看，或复制五列表格使用粘贴导入。扩展不会自动提交教务表单或切换学期。
