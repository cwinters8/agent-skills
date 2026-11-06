# Example hand-off

A made-up PR, to show the shape. `owner/repo#12` makes outbound webhook
deliveries retry with backoff, and closes issue #9.

## The chat message

> **What changed in your mental model**
>
> 1. A failed delivery is no longer dropped. It is retried five times over
>    about an hour, then parked in a dead-letter table you can replay.
> 2. A receiver that answers 410 Gone is unsubscribed on the spot, with no
>    retries.
>
> **What you need to do:** one step after deploy, setting the alert threshold.
> The command is in the map with a copy button.
>
> Map: https://claude.ai/artifact/... (the quiz is at the bottom)

Five short lines. The two mental-model items are behavior, not files, and the
detail lives in the map.

## A multiple-choice question

```html
<div class="q c-a1" data-q>
  <span class="qt">1. Why does the retry delay grow each time instead of staying at one minute?</span>
  <div class="opts">
    <button type="button" class="opt" data-why="Order isn't the issue: each delivery carries its own sequence number. Think about what a receiver that is down is going through.">So deliveries arrive in order</button>
    <button type="button" class="opt" data-right data-why="Right. A receiver that is down is usually down because it is overloaded. Fixed one-minute retries from every sender hit it again all at once, and growing gaps let it recover. The jitter on each delay spreads senders out further.">So a struggling receiver gets room to recover</button>
    <button type="button" class="opt" data-why="The table is small either way. Five retries is the cap whatever the spacing. The spacing is about the receiver, not about storage.">To keep the retry table small</button>
  </div>
  <p class="fb" hidden></p>
</div>
```

Each wrong option is a misreading a careful skimmer could make, and its
explanation points at the real reason without giving it away.

## The short-answer question

```html
<div class="q c-a2" data-sa data-qnum="4"
     data-question="Why does a 410 Gone unsubscribe the receiver immediately, when every other error is retried?"
     data-key="Context: the PR retries failed webhook deliveries with backoff, except that a 410 response unsubscribes the receiver at once. Key points: (1) 410 means the receiver says the endpoint is gone for good, so a retry cannot succeed; (2) retrying would spend an hour of attempts and fill the dead-letter table with deliveries nobody will accept; (3) other errors, like 500 or a timeout, are usually temporary, so retrying them is worth it. Point 1 alone earns a pass.">
  <span class="qt">4. In your own words: why does a 410 unsubscribe the receiver right away, when every other error is retried?</span>
  ...
</div>
```

`data-question` stands on its own, because "Copy for chat" sends it with no
page beside it. `data-key` gives the grader the context it has no other way to
know, the points to look for, and the bar for a pass.
