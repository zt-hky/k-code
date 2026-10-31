K-code can resume native sessions that agents stored on the server's machine, so work you started in a terminal continues in the app.

## Resume from a project

In a project, choose **Resume session…**. The dialog lists that provider's earlier sessions for the project folder. Pick one to import it as a K-code thread and continue where it stopped.

Today this works for ACP-based providers that support session listing and loading, including [Oh My Pi](/docs/providers/oh-my-pi/).

## All projects

Switch the dialog scope to **All projects** to list sessions from every folder. If you resume a session whose folder is not a K-code project yet, K-code adds the project first, then imports the session.

## Titles

Each session is titled, in order, by:

1. the K-code thread title, if the session is already bound to a thread
2. the title Oh My Pi stored for the session (icon glyphs at the start are stripped)
3. its first user message, for sessions Oh My Pi never titled
4. "Untitled", with the time, when nothing else exists

The imported thread uses the resolved title.

## Titles flow back

Renaming an Oh My Pi thread in K-code, or K-code auto-titling it, updates the title stored in the Oh My Pi session file. `omp`'s own resume list then shows the same name. Only the title record at the top of the session file is rewritten, in place; session history is never modified, and nothing is written if the title already matches.

## Forking

Forking from an earlier turn starts the fork from a summary of the thread rather than from the agent's own session, unless the provider supports native fork.
