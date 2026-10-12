import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'

export const connectionSchema = z.object({host:z.string().min(1).max(255),port:z.number().int().min(1).max(65535),
  database:z.string().min(1).max(128),user:z.string().min(1).max(128),tls:z.boolean().default(true),
  table:z.string().min(1).max(128),columns:z.object({id:z.string(),title:z.string(),answer:z.string(),
    question:z.string().optional(),aliases:z.string().optional(),url:z.string().optional()}),
  entryMode:z.enum(['RAG','FIXED']).default('RAG')})
export type DatabaseConnection = z.infer<typeof connectionSchema>
export function selectStatement(kind:string, config:DatabaseConnection) {
  if (!['POSTGRES','MYSQL'].includes(kind)) throw new BadRequestException('不支持的数据库类型')
  const quote = (s:string,qualified = false) => {
    const parts = qualified ? s.split('.') : [s]
    if (parts.length > 2 || parts.some(p => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p))) throw new BadRequestException('表名和列名只允许字母、数字及下划线；表名可带 schema')
    const q = kind === 'POSTGRES' ? '"' : '`'
    return parts.map(p => q+p+q).join('.')
  }
  const columns = Object.entries(config.columns).filter(([,v]) => v).map(([alias,col]) => `${quote(col!)} AS ${quote(alias)}`)
  return `SELECT ${columns.join(', ')} FROM ${quote(config.table,true)} ORDER BY ${quote(config.columns.id)} LIMIT 10001`
}
export async function readExternalDatabase(kind:string, config:DatabaseConnection, password:string):Promise<Record<string,any>[]> {
  const sql = selectStatement(kind,config)
  if (kind === 'POSTGRES') {
    const {Client} = require('pg')
    const client = new Client({host:config.host,port:config.port,database:config.database,user:config.user,password,
      ssl:config.tls ? {rejectUnauthorized:true} : false,connectionTimeoutMillis:10000,query_timeout:15000,statement_timeout:15000})
    try {
      await client.connect(); await client.query('BEGIN READ ONLY')
      const result = await client.query(sql)
      await client.query('ROLLBACK')
      return result.rows
    } finally {await client.end()}
  }
  const mysql = require('mysql2/promise')
  const client = await mysql.createConnection({host:config.host,port:config.port,database:config.database,user:config.user,password,
    ssl:config.tls ? {rejectUnauthorized:true} : undefined,connectTimeout:10000,multipleStatements:false})
  try {
    await client.query('START TRANSACTION READ ONLY')
    const [rows] = await client.query({sql,timeout:15000})
    await client.query('ROLLBACK')
    return rows
  } finally {await client.end()}
}
