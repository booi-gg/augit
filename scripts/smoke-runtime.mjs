import { getLlama } from "node-llama-cpp";

const llama = await getLlama();

try {
  process.stdout.write(`node-llama-cpp ready (${llama.gpu || "cpu"})\n`);
} finally {
  await llama.dispose();
}
