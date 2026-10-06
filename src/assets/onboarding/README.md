# Onboarding clips

Place optional square MP4 clips in this folder to replace the three illustrations:

- `record.mp4`
- `preview.mp4`
- `share.mp4`

They are discovered at build time. Use short, silent H.264 MP4s with the important
content inside the square frame. Clips loop muted while the page is open, and
show playback controls instead of autoplay when reduced motion is enabled.
Missing or failed clips retain the illustration. Change the paragraph in
`src/components/auth/OnboardingFeature.tsx` to update the introductory copy.
