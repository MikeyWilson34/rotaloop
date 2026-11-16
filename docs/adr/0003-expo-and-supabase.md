# Expo (React Native) app with a Supabase backend

The app is built with Expo, so one React Native codebase targets iOS, Android and web. The backend is Supabase: Postgres, Auth, row-level security and Realtime. The domain is relational: Groups, Memberships, Rotations, Assignments and an audit-style schedule history, with fairness queries over counts and dates. That fits Postgres better than a document store such as Firebase. Row-level security can express per-Group permissions directly, and Realtime keeps Coverage Requests ("first tap wins") current across devices. The lock-in is real: Auth, RLS policies and Edge Functions would take significant work to move.

## Considered Options

- **Expo + Firebase.** Push notifications are strong, but fairness queries and history are awkward in a document model.
- **Flutter + Supabase.** It would work, but it means Dart and a smaller library ecosystem, with no offsetting benefit for this app.
