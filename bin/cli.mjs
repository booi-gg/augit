#!/usr/bin/env node

import { run } from "../src/index.mjs";

process.exitCode = await run(process.argv.slice(2));
