# Focus Tracker Menubar Panel Design

## Goal

Turn the current desktop debug panel into a default menubar experience that only shows operational focus status.

## Default Panel

The default panel should only show:

- today's total focus time
- current activity
- automatic upload status
- a simplified local timeline
- an `Open /focus` action

The default panel should not show:

- `Base URL`
- `Device token`
- manual upload buttons
- sample / flush / fixture actions
- raw device identifiers

## Setup And Failure States

Configuration should be hidden by default.

Only show a `Fix setup` entry point when one of these is true:

- there is no saved device token
- automatic upload has failed
- the configured server base URL is empty

When `Fix setup` is opened, show a compact setup form containing:

- base URL
- device token
- save action

This setup form is a recovery path, not part of the steady-state UI.

## Upload Model

Uploads are always automatic in the background loop.

The panel should communicate one of:

- syncing automatically
- last uploaded at `<time>`
- setup required
- attention needed

There should be no manual upload control in the default panel.

## Visual Direction

- Keep the existing compact glass panel aesthetic
- Reduce vertical noise by removing the secondary collector section
- Keep the hero metric, current activity card, upload card, and one timeline block
- Prefer one callout for setup/error states instead of a permanent form
