import { BadRequestException } from '@nestjs/common'
import { UI_COMPONENTS } from './agent-ui'

export type CardRecipe = { name: string; keywords: string[]; components: string[]; layout: 'grid' | 'stack' }
export type PresentationPolicy = { maxCards: number; fallback: 'fixed' | 'text'; recipes: CardRecipe[] }

export function validateRecipes(value: unknown): value is CardRecipe[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(recipe =>
    !recipe || typeof recipe.name !== 'string' || !recipe.name.trim() || recipe.name.length > 45 ||
    !['grid', 'stack'].includes(recipe.layout) || !Array.isArray(recipe.keywords) ||
    recipe.keywords.length < 1 || recipe.keywords.length > 8 ||
    recipe.keywords.some((keyword: unknown) => typeof keyword !== 'string' || !keyword.trim() || keyword.length > 32) ||
    !Array.isArray(recipe.components) || recipe.components.length < 1 || recipe.components.length > 5 ||
    recipe.components.some((type: unknown) => typeof type !== 'string' || !Object.hasOwn(UI_COMPONENTS, type) || type === 'page')
  )) throw new BadRequestException('卡片模板最多 20 套，每套须填写名称、1–8 个关键词、1–5 个注册组件和 stack/grid 布局')
  return true
}

export function matchingRecipe(query: string, recipes: CardRecipe[] = []) {
  const normalized = query.toLowerCase()
  return recipes.find(recipe => recipe.keywords.some(keyword => normalized.includes(keyword.trim().toLowerCase())))
}
