/** A message that invokes a skill by name, with whatever followed it. */
export interface SlashInvocation {
  name: string;
  argumentText: string;
}
