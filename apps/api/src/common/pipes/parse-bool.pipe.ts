import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform
} from "@nestjs/common"

/** 把 "1"/"true" 之类的查询串转成真正的布尔值 */
@Injectable()
export class ParseBoolPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (value === undefined || value === null || value === "") return undefined
    if (typeof value === "boolean") return value
    const normalized = String(value).toLowerCase()
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
    throw new BadRequestException(
      `${metadata.data ?? "参数"} 不是合法的布尔值`
    )
  }
}