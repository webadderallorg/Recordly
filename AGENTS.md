# AGENTS.md

## Repository Architecture & Code Navigation Protocol

This repository uses **Graft** to provide an AST-based architecture context layer.

### Rules for AI Coding Agents:
1. **Never Explore Blindly**: Do NOT scan full source files or run broad regex searches across the codebase when trying to locate functions, classes, or interfaces.
2. **Consult Graft First (Zero-Token Orientation)**:
   - Run `.\scripts\graft-query.ps1 map` or inspect `graft/INDEX.md` for immediate subsystem orientation, hub symbols, and coupling hotspots.
   - Read the relevant card in `graft/<path>.md` (e.g. `graft/services/TabGroupService.md`) to find:
     - Function, method, interface, and class names
     - Parameter signatures and return types
     - Exact line ranges (e.g. `L60-L82`)
3. **Trace Callers & Dependencies**:
   - Run `.\scripts\graft-query.ps1 callers <symbol>` to verify who calls a function before altering its behavior.
   - The complete relation graph (calls, imports, contains) is recorded in `graft/.graph/wiring.json`.
4. **Targeted Reads**: When inspecting or modifying code, only view the specific line range identified in the Graft card.
5. **Updating the Graph**:
   - If major architectural changes or new files are added, run:
     ```powershell
     .\scripts\graft-build.ps1
     ```
