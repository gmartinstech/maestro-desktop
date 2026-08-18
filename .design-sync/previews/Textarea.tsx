import { Stack, Textarea } from '@martinstech/maestro-ds';

export const Basic = () => (
  <Stack style={{ maxWidth: 460 }}>
    <Textarea
      id="t1"
      label="Description"
      defaultValue="Summarises merged commits into a changelog and posts it to the release channel."
      hint="Shown on the agent card."
    />
  </Stack>
);

export const SystemPrompt = () => (
  <Stack style={{ maxWidth: 460 }}>
    <Textarea
      id="t2"
      label="System prompt"
      mono
      rows={6}
      defaultValue={
        'You are the release notes agent for Maestro Studio.\nSummarise merged commits since the last tag.\nGroup by area, lead with anything touching auto-update.'
      }
    />
  </Stack>
);

export const ErrorState = () => (
  <Stack style={{ maxWidth: 460 }}>
    <Textarea id="t3" label="Input schema" mono defaultValue={'{ "repo": '} error="Not valid JSON — unexpected end of input." />
  </Stack>
);
