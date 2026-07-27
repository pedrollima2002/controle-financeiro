import { executeTests } from "./tests.js";

const outcomes = await executeTests();
const failed = outcomes.filter((item) => !item.passed);

console.log(`${outcomes.length - failed.length} de ${outcomes.length} testes passaram.`);
failed.forEach((item) => console.error(`FALHOU — ${item.name}: ${item.error}`));

if (failed.length) process.exitCode = 1;
