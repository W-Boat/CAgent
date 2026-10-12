#!/bin/bash
#
# 生产库迁移：新增「教师（小管理）」角色 + student:preview 权限
#
# 为什么用 SQL 而不是跑 sync-system-roles.ts：
#   生产的 API 是 3 天前构建的 Docker 镜像。要用 TS 脚本同步，
#   就得把本地源码同步上去并重建镜像 —— 那会把本地其它改动
#   （比如 loveline 模块，生产是刻意没有的）一起带上线。
#   本次改动只涉及「权限目录 + 角色 + 授权」三类数据，
#   直接改库最小、最可控，也不必重启任何容器（权限是每次请求从库读的）。
#
# 幂等：全部用 where not exists / on conflict 保护，可反复执行。
#
set -euo pipefail

BACKUP_DIR=/opt/cagent-backups
STAMP=$(date +%Y%m%d-%H%M%S)
PSQL="docker exec -i cagent-db psql -U cagent -d cagent -v ON_ERROR_STOP=1"

echo "=== 0. 备份 ==="
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/db-$STAMP.sql"
docker exec cagent-db pg_dump -U cagent -d cagent > "$BACKUP"
echo "备份 → $BACKUP ($(du -h "$BACKUP" | cut -f1))"

echo
echo "=== 1. 迁移前状态 ==="
$PSQL -t -A -F'|' -c "
select r.key, count(rp.\"permissionId\")
from roles r left join role_permissions rp on rp.\"roleId\" = r.id
group by r.key order by r.key;"

echo
echo "=== 2. 应用迁移 ==="
$PSQL <<'SQL'
begin;

-- 2.1 新权限码：查看学生端
--     只有管理员该有：教师进学生端什么也审不了，会被前端送回后台。
insert into permissions (id, code, name, "group", created_at)
select 'perm_student_preview', 'student:preview', '查看学生端', 'system', now()
where not exists (select 1 from permissions where code = 'student:preview');

-- 2.2 教师角色
insert into roles (id, key, name, description, is_system, sort, created_at, updated_at)
select 'role_teacher', 'teacher', '教师（小管理）',
       '查看数据看板、审核学生问答与自学习条目，不改配置',
       true, 5, now(), now()
where not exists (select 1 from roles where key = 'teacher');

-- 2.3 教师权限：以代码定义为准，先清后建
--     清单见 apps/api/src/common/constants/permissions.ts 的 SYSTEM_ROLES.teacher
delete from role_permissions
where "roleId" = (select id from roles where key = 'teacher');

insert into role_permissions ("roleId", "permissionId")
select (select id from roles where key = 'teacher'), p.id
from permissions p
where p.code in (
  'dashboard:read',
  'conversation:read',
  'message:read',
  'message:flag',
  'learning:read',
  'learning:review',
  'usage:read',
  'user:read',
  'agent:read'
);

-- 2.4 student:preview 授予管理员与超管
--     生产的 super_admin 是 50 条显式权限（不是 * 通配），所以要单独授。
insert into role_permissions ("roleId", "permissionId")
select r.id, (select id from permissions where code = 'student:preview')
from roles r
where r.key in ('admin', 'super_admin')
  and not exists (
    select 1 from role_permissions rp
    where rp."roleId" = r.id
      and rp."permissionId" = (select id from permissions where code = 'student:preview')
  );

-- 2.5 把教师账号从「普通用户」改绑到「教师」
--     先移除它身上的系统角色，避免 user + teacher 叠加导致身份含糊
delete from user_roles
where "userId" = (select id from users where email = 'teacher@cagent.local')
  and "roleId" in (select id from roles where is_system = true);

insert into user_roles ("userId", "roleId")
select u.id, (select id from roles where key = 'teacher')
from users u
where u.email = 'teacher@cagent.local'
  and not exists (
    select 1 from user_roles ur
    where ur."userId" = u.id
      and ur."roleId" = (select id from roles where key = 'teacher')
  );

commit;
SQL
echo "迁移已提交"

echo
echo "=== 3. 迁移后核对 ==="
$PSQL -t -A -F'|' -c "
select r.key, r.name, count(rp.\"permissionId\") as perms
from roles r left join role_permissions rp on rp.\"roleId\" = r.id
group by r.key, r.name order by min(r.sort), r.key;"

echo
echo "--- teacher 角色的实际权限 ---"
$PSQL -t -A -c "
select p.code from role_permissions rp
join permissions p on p.id = rp.\"permissionId\"
where rp.\"roleId\" = (select id from roles where key = 'teacher')
order by p.code;" | tr '\n' ' '
echo

echo
echo "--- 各角色的 dashboard:read / student:preview ---"
$PSQL -t -A -F'|' -c "
select r.key,
       bool_or(p.code = 'dashboard:read') as can_backend,
       bool_or(p.code = 'student:preview') as can_preview_student
from roles r
left join role_permissions rp on rp.\"roleId\" = r.id
left join permissions p on p.id = rp.\"permissionId\"
group by r.key order by r.key;"

echo
echo "--- 账号角色 ---"
$PSQL -t -A -F'|' -c "
select u.email, coalesce(string_agg(r.key, ','), '-')
from users u
left join user_roles ur on ur.\"userId\" = u.id
left join roles r on r.id = ur.\"roleId\"
where u.email in ('teacher@cagent.local','admin@cagent.local','student@cagent.local','admin@boaty.icu')
group by u.email order by u.email;"

echo
echo "迁移完成"
