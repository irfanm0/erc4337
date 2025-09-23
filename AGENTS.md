# Repository Guidelines

## Project Structure & Module Organization
The `contracts/` directory holds the ERC-4337 smart contracts (Account, AccountFactory, Paymaster, delegates). Deployment automation lives in `ignition/modules/` and ad-hoc helpers in `scripts/`; tests sit under `test/` and rely on TypeScript + Mocha/Chai. Build artefacts (`artifacts/`, `cache/`, `typechain-types/`) are generated—leave them untracked. Core configuration is handled in `hardhat.config.ts` and `rpcList.ts`; supply RPC URLs and keys through a local `.env`.

## Build, Test, and Development Commands
- `npm install` — install dependencies and refresh TypeChain typings.
- `npx hardhat compile` — compile Solidity using optimizer settings from the config.
- `npx hardhat test` — execute the automated suite on the fork-aware Hardhat network.
- `REPORT_GAS=true npx hardhat test` — capture gas metrics to spot regressions.
- `npx hardhat node` — run the configured fork (`FORK_NETWORK`) locally for interactive testing.
- `./verify.sh <network> <contract>` — wrapper around `hardhat verify` with the configured API keys.

## Coding Style & Naming Conventions
Solidity files use four-space indentation, `CamelCase` contracts, and `camelCase` functions; mirror the existing `require` messages for clarity. Prefer explicit visibility modifiers and keep shared constants in dedicated libraries if they emerge. Scripts and tests use TypeScript—keep filenames in `lower-kebab-case.ts`, embrace `async`/`await`, and never edit generated `typechain-types/` output.

## Testing Guidelines
Add new specs under `test/ContractName.test.ts`, grouping cases with Mocha `describe` blocks that mirror function names and include behavioural context. Always run `npx hardhat test` (and the gas variant when changing execution paths) before pushing. Cover both merchant and platform signer flows and assert emitted events when introducing account-authorized behaviour.

## Commit & Pull Request Guidelines
Commit messages follow an imperative subject line (`Add…`, `Refactor…`) and focus on a single concern; stage artefact changes only when required for reviewers. Pull requests should link relevant issues, describe the scenario touched, and include local command output or fork transaction hashes for operational changes. Confirm the working tree is clean and lint/tests pass before requesting review.

## Security & Configuration Tips
Secrets stay in `.env` (e.g., `PRIVATE_KEY`, `DEV_PRIVATE_KEY`); verify `.gitignore` before committing. When switching networks or block numbers in `hardhat.config.ts`, double-check `rpcList.ts` endpoints and document the update in the PR body.
