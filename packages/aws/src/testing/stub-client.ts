// D26, pp-testing → AWS adapters: the stubbed SDK client every `packages/aws` test hands its module.
// `send(command)` records the command's name (the class name less `Command`) and `input`, then
// answers from the script the test wrote for that name. A missing script fails the test loudly. The
// commands sent are the consequence at this seam, so a test asserts `sent`. Test-only, never
// exported from the package.

export type CommandInput = Readonly<Record<string, unknown>>;

export type SentCommand = { readonly name: string; readonly input: CommandInput };

// What a scripted command answers: its output, or a rejection (an SDK error carrying the name the
// operation's API Reference page lists).
export type ScriptedAnswer = (input: CommandInput) => unknown;

export class StubClient {
  readonly sent: SentCommand[] = [];
  readonly #answers = new Map<string, ScriptedAnswer>();

  answer(name: string, answer: ScriptedAnswer): this {
    this.#answers.set(name, answer);
    return this;
  }

  async send(command: { readonly input: object }): Promise<unknown> {
    const name = command.constructor.name.replace(/Command$/, '');
    const input = command.input as CommandInput;
    this.sent.push({ name, input });
    const answer = this.#answers.get(name);
    if (answer === undefined) throw new TypeError(`StubClient: no scripted answer for ${name}`);
    return answer(input);
  }

  // The names of the commands sent so far, in order.
  names(): string[] {
    return this.sent.map((command) => command.name);
  }

  // The inputs of every command sent under `name`, in order.
  inputs(name: string): CommandInput[] {
    return this.sent.filter((command) => command.name === name).map((command) => command.input);
  }

  // The stub typed as the SDK client a module takes. It implements only `send`, the one member any
  // module in this package calls.
  as<Client>(): Client {
    return this as unknown as Client;
  }
}
