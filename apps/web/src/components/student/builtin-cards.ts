export interface BuiltinCard {
  id: string
  group: string
  card: Record<string, unknown>
}

// Domain-specific cards are supplied by each deployment.
export const BUILTIN_CARDS: BuiltinCard[] = []
export const CARD_HINT = "选择一个常见问题"
