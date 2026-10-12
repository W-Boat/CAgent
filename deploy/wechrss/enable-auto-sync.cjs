const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
(async()=>{
 const bases=await db.knowledgeBase.findMany({where:{kind:'WECHAT'}}),changed=[];
 for(const base of bases){
  const connection=base.connection;
  if(connection?.mode!=='API'||!connection.managed||!base.automationUserId||connection.autoSync===true)continue;
  const owner=await db.user.findFirst({where:{id:base.automationUserId,status:'ACTIVE'},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
  if(!owner?.roles.some(r=>r.role.permissions.some(p=>['*','campus:admin'].includes(p.permission.code))))continue;
  await db.$transaction(async tx=>{
   const result=await tx.knowledgeBase.updateMany({where:{id:base.id,updatedAt:base.updatedAt},data:{connection:{...connection,autoSync:true}}});
   if(!result.count)throw new Error('Source configuration changed; migration stopped');
   await tx.auditLog.create({data:{userId:owner.id,actor:'采集器迁移',action:'knowledge.wechat.auto_sync.enable',resource:'knowledge_base',resourceId:base.id,detail:{engine:'WECHRSS',previousAutoSync:connection.autoSync??false,autoSync:true},success:true}});
  });changed.push(base.name);
 }
 const current=await db.knowledgeBase.findMany({where:{kind:'WECHAT'},include:{_count:{select:{entries:true}}}});
 console.log(JSON.stringify({enabled:changed,bases:current.map(b=>({name:b.name,entries:b._count.entries,mounted:b.mounted,autoSync:b.connection?.autoSync===true,aiReviewEnabled:b.aiReviewEnabled,aiSummaryEnabled:b.aiSummaryEnabled}))}));
})().catch(()=>{console.error('Automatic synchronization migration failed; inspect source configuration');process.exitCode=1}).finally(()=>db.$disconnect());
