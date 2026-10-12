import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common"
import { PrismaClient } from "@prisma/client"

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name)

  constructor() {
    super({
      log: [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" }
      ]
    })
  }

  async onModuleInit() {
    await this.$connect()
    this.logger.log("数据库连接已建立")
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }

  /** 分页查询的统一封装 */
  async paginate<T = any>(
    model: {
      findMany: (args: any) => Promise<any[]>
      count: (args: any) => Promise<number>
    },
    args: { where?: any; orderBy?: any; include?: any; select?: any } = {},
    page = 1,
    pageSize = 20
  ): Promise<{ items: T[]; total: number; page: number; pageSize: number }> {
    const safePage = Math.max(1, Number(page) || 1)
    const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 20))

    const [items, total] = await Promise.all([
      model.findMany({
        ...args,
        skip: (safePage - 1) * safeSize,
        take: safeSize
      }),
      model.count({ where: args.where })
    ])

    return { items, total, page: safePage, pageSize: safeSize }
  }
}