// The dApp's own params, as an object. The prepare call acts as the signing party and reads as
// nobody, so nothing here is rewritten: what the approval modal shows is what the dApp sent.
export const executeParams = (params: unknown): Record<string, unknown> =>
  typeof params === 'object' && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {}

// The party a dApp asks to act as. Absent means the dApp left the choice to the wallet; present
// and unheld is a request the wallet must refuse rather than sign as somebody else.
export const requestedActAs = (params: Record<string, unknown>): string | undefined =>
  Array.isArray(params.actAs) && typeof params.actAs[0] === 'string' ? params.actAs[0] : undefined

// Extracts the original dApp commands for the Activity audit payload.
export const transactionCommands = (params: Record<string, unknown>): unknown[] | undefined => {
  const commands = params.commands
  return Array.isArray(commands) ? commands : undefined
}

// The contracts a dApp discloses alongside its commands, which the prepare call needs verbatim.
export const disclosedContracts = (params: Record<string, unknown>): unknown[] | undefined =>
  Array.isArray(params.disclosedContracts) ? params.disclosedContracts : undefined

// Counts commands without assuming a specific DAML command shape.
export const commandCount = (params: Record<string, unknown>): number | undefined => {
  const commands = transactionCommands(params)
  return commands?.length
}

// Short Activity row summary derived from the first command.
export const commandSummary = (params: Record<string, unknown>): string => {
  const commands = transactionCommands(params)
  if (commands === undefined || commands.length === 0) {
    return 'Canton transaction'
  }
  const first = commands[0]
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    return `${commands.length} command${commands.length === 1 ? '' : 's'}`
  }
  const [kind] = Object.keys(first)
  if (kind === undefined) {
    return `${commands.length} command${commands.length === 1 ? '' : 's'}`
  }
  return commands.length === 1 ? kind : `${kind} + ${commands.length - 1} more`
}

// Drops empty strings so they aren't persisted as optional fields.
export const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined
