# @virentia/forms-react

## 0.2.0

### Minor Changes

- 7a339e7: Support `@virentia/core@0.3`.

  Migrated to the new core where every `store` is read and written through `.value`
  and object state with direct field access uses the new `reactive` unit, and updated
  the effect detection for the de-`$`-prefixed effect stores (`pending`/`inFlight`).

  `@virentia/forms` now requires `@virentia/core >=0.3.0`, and `@virentia/forms-react`
  now requires `@virentia/react >=0.2.2`.

### Patch Changes

- Updated dependencies [7a339e7]
  - @virentia/forms@0.2.0

## 0.1.0

### Minor Changes

- feat: initial release

### Patch Changes

- Updated dependencies
  - @virentia/forms@0.1.0
