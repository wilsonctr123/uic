# UIC Vision: An AI That Understands Your App

## The Goal

UIC is NOT a button clicker. It is NOT a DOM crawler that generates mechanical tests.

**UIC is an AI QA engineer that reads your codebase, understands your product, and tests whether your app actually works — not just whether it renders.**

## What This Means Concretely

When UIC encounters a webapp for the first time, it should:

1. **Read the codebase** — README, CLAUDE.md, docs, route definitions, API endpoints, database schema
2. **Understand each feature's purpose** — "This is a chat interface for querying emails using AI. It has Quick and Deep Think modes."
3. **Reason about what to test** — "I should ask a real email question, verify the response references actual emails, check both modes work differently, and ensure answers arrive within a reasonable time."
4. **Generate intelligent tests** — real inputs derived from the app's data, output quality assertions, mode comparisons
5. **Judge correctness** — "The answer mentions 'Q4 budget' which matches the seed data. The citations link to real emails. This is working correctly."

## Example: Chat Interface Discovery

When UIC sees a chat page, it should NOT think:
> "Found an input and a button. I'll type 'Hello' and click Submit."

It SHOULD think:
> "This is an AI-powered Q&A interface for an email assistant app. The database has 90 emails
> including budget discussions, engineering updates, and patent filings. I should:
>
> 1. Ask about Q4 budget emails → verify response mentions budget content + has citations
> 2. Ask the same query in Deep Think mode → verify it produces more detailed analysis
> 3. Ask about something not in the corpus → verify graceful empty response
> 4. Test conversation persistence → create, navigate away, come back
> 5. Test conversation deletion → click ×, verify it's gone"

## The Principle

**Tests should verify the app fulfills its PURPOSE, not just that it doesn't crash.**

Every test UIC generates should answer: "Does this feature do what the product promised?"

## Non-Negotiable Requirements

1. UIC must READ the codebase before generating any tests
2. Test inputs must be DERIVED from the app's purpose and available data
3. Assertions must check OUTPUT QUALITY, not just output existence
4. AI/LLM features must be tested with REAL queries and output evaluation
5. The reasoning behind each test must be documented (why this test, why this input)
6. All of this must happen AUTOMATICALLY — zero user configuration beyond `npx uic`

## What UIC is NOT

- NOT a record-and-playback tool
- NOT a DOM crawler that clicks every button
- NOT a template-based test generator
- NOT a tool that needs per-app configuration to be useful
- NOT something that generates tests with `'test input value'` or `'Hello'`

## The Bar

If a senior QA engineer would look at UIC's generated tests and say "these are amateur tests that don't actually verify anything" — UIC has failed. The tests should be indistinguishable from what a thoughtful, experienced QA engineer would write after reading the codebase for an hour.
