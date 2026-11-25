import { Info } from 'lucide-react';

/**
 * A small info icon whose words show as a tooltip on hover and are read out when it has focus. For the help text a
 * screen does not need to show all the time (why something is off, what happens next); anything a person must act
 * on stays in the page. It takes the colour of the text around it.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex shrink-0 cursor-help rounded-full opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Info aria-hidden="true" className="icon-size-200" />
    </span>
  );
}
