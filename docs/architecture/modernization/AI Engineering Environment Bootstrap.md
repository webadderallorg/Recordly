# Recordly — AI Engineering Environment Bootstrap

## ROLE

Act as a Principal Software Architect, AI Agent Infrastructure Engineer, Rust Engineering Specialist, Repository Intelligence Engineer, and Developer Tooling Architect.

Your task is to establish a production-grade AI development environment for the existing Recordly repository.

This task is ONLY about creating the engineering environment, project intelligence, continuity system, skills, rules, documentation structure, and workflows that future AI sessions will use to develop Recordly efficiently.

You are NOT being asked to modernize, migrate, refactor, or implement Recordly itself.

---

# 1. ABSOLUTE SCOPE

During this task:

### ALLOWED

You may:

* Inspect the entire repository.
* Analyze the existing architecture.
* Use GRAFT to understand the repository.
* Use OpenSpace to discover and inspect available skills.
* Inspect existing `.agents/` configuration and skills.
* Inspect Rust, TypeScript, React, Electron, native, media, and build infrastructure.
* Create AI/project documentation.
* Create or improve AI Skills.
* Create project rules and development workflows.
* Create scripts or configuration required ONLY for the AI engineering environment.
* Create architecture/context/continuity metadata.
* Validate the resulting environment.
* Run read-only analysis commands.
* Run safe validation commands that do not modify application source code.

### FORBIDDEN

Do NOT:

* Rewrite Recordly.
* Migrate Electron to Tauri.
* Implement Rust features.
* Refactor application source code.
* Rewrite React components.
* Change application architecture.
* Replace dependencies.
* Install application dependencies.
* Implement Windows/macOS/Web/iOS/Android support.
* Implement LLM functionality in Recordly.
* Optimize the application itself.
* Modify application behavior.
* Delete existing application files.
* Use sub-agents.
* Delegate analysis or implementation to other agents.

The only source-code changes permitted are files that belong explicitly to the AI engineering environment created by this task.

If there is uncertainty whether a file is application code or environment infrastructure, DO NOT modify it.

---

# 2. PRIMARY OBJECTIVE

Build an AI development environment where:

> The repository, not the conversation, becomes the long-term source of project knowledge.

A future AI session must be able to start with minimal context and determine:

* What Recordly is.
* How the repository is currently structured.
* What architectural principles exist.
* What decisions have already been made.
* What is currently being developed.
* What the previous session completed.
* What remains unfinished.
* Which files are relevant to the current task.
* Which skills should be loaded.
* How the AI is expected to work.
* How Rust code must be engineered.
* How GRAFT should be used.
* How OpenSpace should be used.
* How work must be validated.
* Where the next session should continue.

The system must minimize unnecessary context consumption.

---

# 3. CORE PRINCIPLE

Design the environment around this model:

```text
Conversation
    │
    │ temporary context
    ▼
AI Session
    │
    ├── GRAFT
    │     └── Repository intelligence
    │
    ├── OpenSpace
    │     └── Skill discovery
    │
    ├── Project Skills
    │     ├── Rust Engineering
    │     ├── Architecture
    │     ├── Performance
    │     └── Cross-platform
    │
    └── Project Continuity
          ├── Current State
          ├── Active Task
          ├── Decisions
          └── Session Handoff
                    │
                    ▼
              Repository
```

The conversation is disposable.

The repository must preserve the knowledge required to continue development.

---

# 4. FIRST STEP — INSPECT THE ENVIRONMENT

Before creating anything:

1. Inspect repository structure.
2. Identify the project root.
3. Identify the frontend architecture.
4. Identify Electron architecture.
5. Identify existing native code.
6. Identify Rust code, if any.
7. Identify build systems.
8. Identify package managers.
9. Identify tests.
10. Identify existing documentation.
11. Identify existing `.agents/` configuration.
12. Identify existing skills.
13. Identify existing AI-related instructions.
14. Identify existing GRAFT installation and capabilities.
15. Identify OpenSpace installation and capabilities.
16. Identify existing project rules.
17. Identify existing architecture documentation.
18. Identify existing CI or validation workflows.

Do not assume any tool, command, directory, dependency, or skill exists.

Verify it first.

---

# 5. GRAFT — REQUIRED REPOSITORY INTELLIGENCE

GRAFT MUST be used if it is available.

Before creating architecture context, use GRAFT to understand the actual repository.

Inspect:

* Repository structure.
* Entry points.
* Major modules.
* Dependency relationships.
* Electron main process.
* Electron IPC.
* React frontend.
* Recording system.
* Audio system.
* Cursor system.
* Video editor.
* Export pipeline.
* Native integrations.
* Existing Rust.
* Existing Swift/Objective-C/C++/C code.
* API boundaries.
* AI/LLM code.
* Tests.
* Build system.
* TODOs.
* Potential duplication.
* Highly coupled areas.

Use the installed GRAFT documentation and supported commands.

If `plan2` or another structural planning capability exists, use it where appropriate.

Do NOT invent GRAFT commands.

Do NOT repeatedly scan the entire repository if GRAFT can provide reusable structural information.

The final environment must contain enough repository intelligence to avoid requiring every future session to rediscover the entire codebase.

---

# 6. OPENSPACE — REQUIRED SKILL DISCOVERY

OpenSpace MUST be used if available.

First inspect its actual documentation and available capabilities.

Discover skills relevant to:

* Repository analysis.
* Software architecture.
* Rust.
* Rust performance.
* React.
* TypeScript.
* Tauri.
* Cross-platform development.
* Native Windows development.
* macOS development.
* Media processing.
* Testing.
* Performance engineering.
* API design.
* AI/LLM provider architecture.
* Code review.
* Documentation.

Do not invent skill names.

Do not install unnecessary skills.

Do not modify third-party skills.

Use OpenSpace to determine which existing skills can be reused instead of creating duplicate skills.

---

# 7. PROJECT CONTINUITY SYSTEM

Create a lightweight project continuity system.

Use an appropriate existing documentation location if one already exists.

If no suitable structure exists, create:

```text
docs/
└── ai/
    ├── PROJECT_CONTEXT.md
    ├── CURRENT_STATE.md
    ├── ACTIVE_TASK.md
    ├── ARCHITECTURE_CONTEXT.md
    ├── DEVELOPMENT_RULES.md
    ├── DECISIONS.md
    ├── KNOWN_ISSUES.md
    ├── ROADMAP_CONTEXT.md
    ├── SESSION_HANDOFF.md
    │
    ├── decisions/
    │   └── ...
    │
    ├── history/
    │   └── ...
    │
    └── subsystems/
        └── ...
```

Adapt this structure to the repository if an existing documentation architecture is better.

Do not create redundant documentation systems.

---

# 8. PROJECT_CONTEXT.md

Create a concise permanent project identity.

It should contain only information that future sessions frequently need.

Include:

* Project name.
* Product purpose.
* High-level architecture.
* Current technology stack.
* Supported/planned platforms.
* Major subsystems.
* Core architectural principles.
* Important constraints.
* Important development rules.
* AI workflow.
* Links to deeper documentation.

Do NOT turn this into a giant technical document.

Target:

> A new AI session should understand the project in a few thousand tokens or less.

---

# 9. CURRENT_STATE.md

Create a compact snapshot of the current project state.

Structure approximately:

```md
# Current State

## Current Phase

## Current Architecture

## Active Development Area

## Recently Completed

## Current Problems

## Known Blockers

## Important Recent Decisions

## Verification Status

## Next Recommended Action

## Relevant Files
```

Keep this file short.

It represents the CURRENT STATE, not the history of the project.

Do not append unlimited historical information.

---

# 10. ACTIVE_TASK.md

Create a focused task context.

It must contain:

```md
# Active Task

## Objective

## Scope

## Non-Goals

## Relevant Files

## Existing Behavior

## Desired Behavior

## Constraints

## Architectural Constraints

## Validation Requirements

## Current Progress

## Remaining Work
```

Only the task currently being worked on belongs here.

Avoid turning it into a general project document.

---

# 11. SESSION_HANDOFF.md

Create a standardized mechanism for ending a session.

It must allow the next AI session to continue without reading the previous conversation.

Use:

```md
# Session Handoff

## Session Objective

## Completed

## Files Changed

## Tests / Verification

## Important Findings

## Decisions Made

## Problems Remaining

## Known Risks

## Exact Next Step

## Relevant Files

## Relevant Documentation
```

The AI must update this file when a meaningful development session ends.

Keep it concise.

Do not copy the entire conversation into it.

---

# 12. ARCHITECTURE_CONTEXT.md

Create a concise architectural map.

It should describe:

* Frontend.
* Application logic.
* Electron.
* Native modules.
* Recording.
* Audio.
* Cursor.
* Video editor.
* Export.
* Storage.
* API.
* AI/LLM.
* Testing.

For every subsystem identify:

```text
Responsibility
Owner
Dependencies
Public Interface
Platform Specificity
Important Files
```

Do not duplicate implementation details from source code.

This document should describe architectural relationships, not replace source code.

---

# 13. DEVELOPMENT_RULES.md

Create the project's AI engineering rules.

Include:

### General

* Read before editing.
* Inspect relevant existing code.
* Reuse existing functionality.
* Prefer the smallest correct change.
* Do not duplicate functionality.
* Do not introduce abstractions without a concrete need.
* Do not introduce dependencies without justification.
* Do not modify unrelated code.
* Do not claim verification without actually running it.

### Architecture

* Maintain clear module ownership.
* Avoid circular dependencies.
* Avoid giant modules.
* Avoid duplicated domain logic.
* Maintain single sources of truth.
* Keep platform-specific functionality isolated.

### Performance

* Measure before optimizing.
* Avoid unnecessary allocations.
* Avoid unnecessary serialization.
* Avoid unnecessary IPC.
* Avoid unnecessary polling.
* Avoid unnecessary background tasks.
* Avoid unnecessary copies.
* Do not assume Rust automatically improves performance.

### Safety

* Avoid unsafe Rust unless justified.
* Isolate unsafe code.
* Validate FFI boundaries.
* Never expose secrets.
* Never log credentials or tokens.

---

# 14. RUST ENGINEERING SKILL

Create a project-specific Rust Engineering Skill.

Before creating it:

1. Check whether a Rust skill already exists.
2. Reuse or extend it if appropriate.
3. Do not create a duplicate skill.

The skill should teach the AI how to engineer Rust code, not simply explain Rust syntax.

It must cover:

* Ownership.
* Borrowing.
* Lifetimes.
* Traits.
* Generics.
* Error handling.
* Async.
* Concurrency.
* Send / Sync.
* Channels.
* Resource management.
* Unsafe Rust.
* FFI.
* Module design.
* Crate boundaries.
* API design.
* Testing.
* Performance.
* Profiling.
* Benchmarking.
* Clippy.
* Rustfmt.
* Cargo.

It must emphasize:

```text
Understand ownership first.
Design interfaces second.
Implement third.
Compile and test continuously.
Measure performance instead of guessing.
```

The skill must prohibit cargo-cult patterns such as:

* `clone()` merely to satisfy the compiler.
* `Arc<Mutex<T>>` without a real concurrency requirement.
* unnecessary async.
* unnecessary traits.
* unnecessary generics.
* unnecessary unsafe.
* unnecessary allocations.
* unnecessary abstraction layers.

These are guidelines, not absolute bans.

The AI must reason about the actual use case.

---

# 15. RUST VALIDATION WORKFLOW

The Rust skill must establish a validation hierarchy.

Where applicable:

```text
cargo fmt
    ↓
cargo check
    ↓
cargo test
    ↓
cargo clippy
    ↓
benchmark / profiling
```

Use the actual workspace configuration.

Never claim a validation command succeeded unless it actually ran.

If validation cannot run, record:

* What was attempted.
* Why it could not run.
* What remains unverified.

---

# 16. PROJECT ARCHITECTURE SKILL

Create or reuse a project architecture skill.

It must teach the AI to:

1. Inspect before designing.
2. Understand current boundaries.
3. Identify ownership.
4. Detect duplication.
5. Detect unnecessary abstractions.
6. Identify platform-specific responsibilities.
7. Design the smallest maintainable architecture.
8. Preserve existing working functionality.
9. Prefer incremental migration.
10. Verify architecture against actual repository structure.

It must explicitly reject generic architecture templates that are not grounded in repository evidence.

---

# 17. PERFORMANCE ENGINEERING SKILL

Create or reuse a performance engineering skill.

It must cover:

* CPU.
* Memory.
* allocations.
* copying.
* I/O.
* IPC.
* serialization.
* GPU.
* synchronization.
* async overhead.
* startup time.
* rendering.
* media pipelines.

The fundamental rule:

> Never optimize based solely on intuition when the bottleneck can be measured.

The AI must distinguish:

```text
Verified bottleneck
Potential bottleneck
Architectural risk
Unverified assumption
```

---

# 18. CROSS-PLATFORM ENGINEERING CONTEXT

Create concise guidance for future development of:

* Windows.
* macOS.
* Web.
* iOS.
* Android.

Do NOT implement these platforms.

Define the architectural principle:

```text
Shared:
    Domain
    Models
    API contracts
    Design tokens
    Business rules
    UI concepts where practical

Platform-specific:
    Screen capture
    Audio capture
    Native windows
    Permissions
    Hardware APIs
    Native encoding
    OS integration
```

The environment must prevent future agents from blindly forcing platform-specific implementations into shared code.

---

# 19. LLM PROVIDER ENGINEERING CONTEXT

If Recordly already contains AI/LLM functionality, analyze it.

Create a concise architectural guideline for future work.

The future architecture should be capable of supporting custom providers such as:

```text
OpenAI-compatible
Custom OpenAI-compatible endpoint
Local model
Cloud provider
Custom provider
```

The environment should guide future agents toward:

```text
Provider Interface
      │
      ├── Authentication
      ├── Model Configuration
      ├── Streaming
      ├── Cancellation
      ├── Timeout
      ├── Retry
      ├── Error Mapping
      └── Usage Metadata
```

Avoid provider-specific logic spreading throughout the application.

Do not implement this system now.

---

# 20. CONTEXT EFFICIENCY RULES

This is a critical requirement.

The environment must be designed to minimize token consumption.

Future AI sessions should NOT automatically read:

* the entire repository.
* every documentation file.
* every ADR.
* complete historical sessions.
* unrelated subsystems.
* entire source files when GRAFT can identify relevant sections.

Use progressive disclosure.

Recommended hierarchy:

```text
LEVEL 0 — ALWAYS

PROJECT_CONTEXT.md
CURRENT_STATE.md
ACTIVE_TASK.md


LEVEL 1 — WHEN ARCHITECTURE IS RELEVANT

ARCHITECTURE_CONTEXT.md
DEVELOPMENT_RULES.md


LEVEL 2 — WHEN A DECISION IS RELEVANT

DECISIONS.md
decisions/*


LEVEL 3 — WHEN A SUBSYSTEM IS RELEVANT

subsystems/*


LEVEL 4 — SOURCE CODE

Use GRAFT to identify relevant files first.
```

The AI must not load more context than necessary.

---

# 21. GRAFT-FIRST CODEBASE EXPLORATION

Create a standard exploration workflow:

```text
Task received
    ↓
Read ACTIVE_TASK
    ↓
Read CURRENT_STATE
    ↓
Determine subsystem
    ↓
Use GRAFT
    ↓
Identify relevant files
    ↓
Inspect only required code
    ↓
Load relevant Skill
    ↓
Design
    ↓
Implement
    ↓
Validate
```

Do not begin by reading the entire repository manually.

---

# 22. OPENSPACE-FIRST SKILL SELECTION

Create a standard skill-selection workflow:

```text
Task
  ↓
Identify task type
  ↓
OpenSpace skill discovery
  ↓
Load relevant skill
  ↓
GRAFT repository analysis
  ↓
Work
```

Do not load every available skill into every session.

Only load skills relevant to the current task.

---

# 23. DECISION SYSTEM

Create an ADR mechanism.

Use:

```text
docs/ai/decisions/
```

Each architectural decision should contain:

```md
# ADR-XXXX — Title

## Status

## Context

## Problem

## Options

## Decision

## Evidence

## Trade-offs

## Consequences

## Revisit Conditions
```

Do not record guesses as accepted decisions.

Do not duplicate the entire ADR into other documents.

`DECISIONS.md` should be an index/summary.

---

# 24. SESSION HISTORY

Use:

```text
docs/ai/history/
```

for meaningful historical session records.

Do not store complete chat transcripts.

Store only:

* important changes.
* important discoveries.
* decisions.
* unresolved issues.
* milestones.

Historical information must never be required for ordinary session startup.

---

# 25. SUBSYSTEM CONTEXT

Create subsystem documentation ONLY for major subsystems that actually exist.

Examples:

```text
docs/ai/subsystems/
    recording.md
    audio.md
    editor.md
    export.md
    frontend.md
    native.md
    ai.md
```

Do not create files for nonexistent subsystems.

Each file should contain:

```text
Purpose
Current Implementation
Important Files
Dependencies
Public Interfaces
Known Problems
Important Decisions
Performance Concerns
Testing
```

Keep them concise.

---

# 26. SINGLE SOURCE OF TRUTH

Establish explicit ownership.

For every important piece of knowledge determine its canonical location.

Example:

```text
Project identity
→ PROJECT_CONTEXT.md

Current state
→ CURRENT_STATE.md

Current task
→ ACTIVE_TASK.md

Architecture
→ ARCHITECTURE_CONTEXT.md

Rules
→ DEVELOPMENT_RULES.md

Decision
→ decisions/ADR-XXXX.md

Decision index
→ DECISIONS.md

Current session
→ SESSION_HANDOFF.md

Historical information
→ history/

Subsystem knowledge
→ subsystems/
```

Do not duplicate authoritative information across files.

Use references instead.

---

# 27. CONSISTENCY VALIDATION

After creating the environment, validate:

### Documentation

* No contradictory architecture statements.
* No duplicate sources of truth.
* No stale claims.
* No invented technologies.
* No invented dependencies.
* No unsupported commands.

### Skills

* No duplicate skills.
* No contradictory instructions.
* No unsupported tools.
* No unnecessary references.
* Clear progressive disclosure.

### Continuity

A new AI session should be able to determine:

```text
What is this project?
What is its current state?
What is being worked on?
What rules apply?
Which files matter?
What decisions already exist?
What happened last session?
What should happen next?
```

without reading the previous conversation.

---

# 28. SESSION START WORKFLOW

Create a reusable workflow/instruction for future sessions:

```text
SESSION START

1. Identify repository root.
2. Read PROJECT_CONTEXT.md.
3. Read CURRENT_STATE.md.
4. Read ACTIVE_TASK.md.
5. Read relevant DEVELOPMENT_RULES.md sections.
6. Read relevant architectural context.
7. Use OpenSpace to identify required skills.
8. Use GRAFT to locate relevant code.
9. Inspect only required files.
10. Confirm task scope.
11. Work.
```

The agent must NOT automatically load the complete project documentation.

---

# 29. SESSION END WORKFLOW

Create a reusable workflow:

```text
SESSION END

1. Verify changes.
2. Run relevant tests.
3. Review final diff.
4. Record important discoveries.
5. Record architectural decisions.
6. Update CURRENT_STATE.md.
7. Update ACTIVE_TASK.md.
8. Update SESSION_HANDOFF.md.
9. Record meaningful history if required.
10. Identify exact next action.
```

Never claim verification that did not happen.

---

# 30. FUTURE DEVELOPMENT RULE

Every future AI implementation task must follow:

```text
UNDERSTAND
    ↓
GRAFT
    ↓
SKILL SELECTION
    ↓
DESIGN
    ↓
MINIMAL CHANGE
    ↓
VALIDATE
    ↓
UPDATE CONTINUITY
```

The AI must not jump directly from user request to code generation.

---

# 31. NO SUB-AGENTS

This environment must explicitly operate without sub-agents.

Do not introduce:

* parallel coding agents.
* delegated repository agents.
* autonomous sub-agent orchestration.

The current system is intentionally:

```text
One AI Agent
    +
GRAFT
    +
OpenSpace
    +
Project Skills
    +
Project Continuity
```

This can be expanded later if explicitly requested.

---

# 32. DO NOT OVER-ENGINEER THE ENVIRONMENT

The environment itself must remain lightweight.

Do not create:

* unnecessary databases.
* unnecessary services.
* unnecessary frameworks.
* unnecessary scripts.
* unnecessary packages.
* duplicate configuration.
* elaborate metadata systems.
* excessive documentation.

Prefer Markdown + existing repository tooling whenever sufficient.

The goal is to reduce complexity, not create another software project around Recordly.

---

# 33. FINAL STRUCTURE

Adapt this structure to the repository rather than blindly creating it:

```text
Recordly/
│
├── .agents/
│   └── skills/
│       ├── rust-engineering/
│       ├── architecture/
│       ├── performance-engineering/
│       └── cross-platform/
│
├── docs/
│   └── ai/
│       ├── PROJECT_CONTEXT.md
│       ├── CURRENT_STATE.md
│       ├── ACTIVE_TASK.md
│       ├── ARCHITECTURE_CONTEXT.md
│       ├── DEVELOPMENT_RULES.md
│       ├── DECISIONS.md
│       ├── KNOWN_ISSUES.md
│       ├── ROADMAP_CONTEXT.md
│       ├── SESSION_HANDOFF.md
│       │
│       ├── decisions/
│       │   └── ADR-*.md
│       │
│       ├── history/
│       │   └── ...
│       │
│       └── subsystems/
│           └── ...
│
└── existing application
```

If the repository already has an equivalent structure, integrate with it instead of creating another one.

---

# 34. FINAL VALIDATION

Before finishing:

1. Verify all created files.
2. Verify referenced files exist.
3. Verify skill structure.
4. Verify OpenSpace compatibility.
5. Verify GRAFT workflow.
6. Verify no application source code was modified.
7. Verify no dependencies were unnecessarily added.
8. Verify no duplicate documentation systems were created.
9. Verify no conflicting instructions exist.
10. Verify the continuity workflow.
11. Verify the session-start workflow.
12. Verify the session-end workflow.

Perform a final consistency audit.

---

# 35. FINAL REPORT

After completing the environment, report:

## Environment Created

List every created or modified AI-environment file.

## Existing Infrastructure Reused

Identify:

* Existing skills.
* Existing documentation.
* Existing GRAFT capabilities.
* Existing OpenSpace capabilities.

## Repository Intelligence

Summarize the major verified architectural areas discovered.

## Continuity System

Explain:

* What is loaded at session start.
* What is loaded only when needed.
* How session handoff works.

## Skills

List the final skills and their responsibilities.

## Validation

List exactly what was validated.

## Limitations

Identify anything that could not be verified.

## Application Changes

Explicitly state:

> No Recordly application functionality was implemented, migrated, or refactored during this task.

---

# FINAL STOP CONDITION

STOP after the environment is created and validated.

Do NOT begin Recordly modernization.

Do NOT migrate Electron.

Do NOT implement Tauri.

Do NOT write new Rust application functionality.

Do NOT implement the cross-platform architecture.

Do NOT implement the LLM provider system.

Do NOT use sub-agents.

The purpose of this task is to prepare the environment so that future sessions can perform those tasks efficiently, consistently, and with minimal context consumption.
