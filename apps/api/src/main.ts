import { NestFactory } from "@nestjs/core"
import { ValidationPipe, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import { join } from "node:path"
import express from "express"
import { AppModule } from "./app.module"
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter"
import { TransformInterceptor } from "./common/interceptors/transform.interceptor"

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn", "debug"]
  })

  const config = app.get(ConfigService)
  const port = Number(config.get("API_PORT") || 3001)
  const prefix = config.get("API_PREFIX") || "api"
  const webOrigin = config.get("WEB_ORIGIN") || "http://localhost:5173"

  app.setGlobalPrefix(prefix)

  /*
   * JSON body 上限：默认 100KB 会拒绝知识包级别的大提示词
   * （技能导入的 systemPrompt 单包可达 ~150KB），放宽到 2MB。
   * 只影响显式带大体的管理操作；对话消息本身很小，不受此影响。
   */
  app.use(express.json({ limit: "2mb" }))
  app.use(express.urlencoded({ extended: true, limit: "2mb" }))

  app.enableCors({
    origin: webOrigin.split(",").map((s) => s.trim()),
    credentials: true
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true }
    })
  )

  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new TransformInterceptor())

  // 静态资源：浏览器截图等运行产物
  app.use(['/static/answer-cache','/static/.private'],(_req,res)=>{res.sendStatus(404)})
  app.use("/static", express.static(join(process.cwd(), "storage"),{dotfiles:'ignore'}))

  // 接口文档：默认开启，可用 ENABLE_DOCS=false 关闭（生产也可以看，方便对接）
  const docsEnabled = config.get("ENABLE_DOCS") !== "false"
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("CAgent API")
      .setDescription("校园 AI Agent 平台后端接口")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup(`${prefix}/docs`, app, document)
  }

  await app.listen(port, "0.0.0.0")

  const logger = new Logger("Bootstrap")
  logger.log(`CAgent API 已启动: http://localhost:${port}/${prefix}`)
  logger.log(`接口文档:        http://localhost:${port}/${prefix}/docs`)
}

bootstrap()
