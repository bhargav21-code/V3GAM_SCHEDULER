# V3GAM — AI Task Scheduler

V3GAM is a productivity application for planning tasks around deadlines, priorities, estimated effort, and available time. It brings task scheduling, habit tracking, reminders, and personal or collaborative workspaces into one interface.

## Overview

V3GAM is designed to help users move from a list of intentions to a practical daily plan. The application combines task management with AI-assisted planning and a responsive interface for reviewing and updating work.

### Core capabilities

- **Task planning:** create and manage tasks, deadlines, priorities, and scheduled work.
- **AI assistance:** use an assistant to help interpret productivity requests and support planning workflows.
- **Calendar-oriented views:** review planned work across time-based views.
- **Habits and progress:** track habits and review completion activity.
- **Reminders and notifications:** support timely follow-up on scheduled work.
- **Workspaces:** separate personal work from collaborative group activity.
- **Responsive experience:** access the application from desktop and mobile-sized screens.
- **Installable web app support:** includes progressive web app assets and service-worker functionality.

Feature availability can depend on application configuration and the services connected to the deployment.

## Technology and architecture

The repository is organized into a browser-facing application, server-side API handlers, shared modules, and SQL migrations.

- **Frontend:** HTML, CSS, and JavaScript under `public/`.
- **API handlers:** JavaScript endpoints under `api/`.
- **Shared server modules:** authentication, Supabase integration, security helpers, and permissions under `lib/`.
- **Database changes:** ordered SQL migrations under `migrations/`.
- **Runtime configuration:** `hatchable.toml` documents application metadata, AI provider configuration, and required secrets for the current runtime.

The current backend imports runtime-provided modules such as `hatchable`. Running the project on a different hosting stack may therefore require adapting those runtime-specific integrations; the repository should not be assumed to be a drop-in, platform-independent deployment.

## Repository structure

```text
.
├── api/                 # Server-side API handlers
├── lib/                 # Shared authentication, security, and data helpers
├── migrations/          # Ordered SQL database migrations
├── public/              # Frontend, styles, scripts, and PWA assets
├── hatchable.toml       # Runtime and application configuration
└── README.md
```

## Configuration

The current configuration expects the following Supabase settings to be supplied through the deployment's secret or environment-variable mechanism:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | URL of the Supabase project used for authentication and application data |
| `SUPABASE_ANON_KEY` | Supabase publishable/anonymous key used by the application |

AI-assisted features may also require a supported AI provider to be configured in the deployment environment. Follow the configuration requirements of the runtime and providers being used.

**Security guidance**

- Never commit API keys, passwords, access tokens, or other secrets to this repository.
- Use a Supabase publishable/anonymous key for client configuration; never expose a Supabase `service_role` key in browser code.
- Review authentication, authorization, database policies, and rate limits before making a deployment publicly accessible.
- Apply database migrations deliberately and verify that the policies match the intended personal-versus-group workspace access model.

## Development and deployment

This repository contains the application source and configuration used by the current project. The API handlers rely on the project's hosting runtime, so the exact local development and deployment commands depend on that runtime.

A safe setup process is:

1. Clone this repository and review the runtime configuration.
2. Configure the required Supabase settings securely in the target environment.
3. Confirm that the target runtime supports the modules imported by the API handlers, or adapt those integrations for the chosen stack.
4. Review and apply the SQL migrations in filename order to the intended database.
5. Test authentication, task operations, workspace permissions, reminders, and AI-assisted flows in a non-production environment.
6. Deploy only after reviewing configuration, access controls, and application behavior.

Do not apply migrations to a production database or change a live deployment without first backing up the relevant data and reviewing the proposed changes.

## Security and testing

The repository includes security and task-permission integration test specifications under `lib/`. Use them as part of a broader verification process, including checks for:

- unauthenticated and unauthorized API requests;
- separation of personal data between users;
- access to shared workspace data by authorized members only;
- behavior after membership or access is revoked;
- request throttling and error handling.

The presence of test specifications does not, by itself, mean that every test has been executed or that a deployment has passed a security audit.

## Contributing

Before submitting a change:

1. Keep changes focused and explain their purpose.
2. Check related frontend and API behavior rather than testing only the changed file.
3. Verify authorization and workspace boundaries for changes involving user data.
4. Avoid including secrets, personal data, or production records in commits.
5. Document any new configuration variables or migration requirements.

## License

No license is currently specified in this repository. Unless a license is added, reuse and redistribution are not automatically granted.
