# Onboarding

Onboarding has two carousel pages: Account and Permissions, selected with the bottom pagination buttons. The Recordly logo sits above the title on each page. Account requires a non-anonymous Supabase session; there is no skip action. The shared banner uses
`public/auth/login-banner.png` in `src/components/auth/OnboardingLayout.tsx`. It grows into the space left by the current page’s content and shrinks to a minimum height in short windows, keeping the form scrollable and the bottom navigation visible.
Permission controls and the final Start recording action live in
`src/components/auth/OnboardingPermissions.tsx`.
