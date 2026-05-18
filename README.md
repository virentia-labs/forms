# Virentia Forms

Form models for Virentia applications.

Virentia Forms keeps form behavior outside the UI: fields store values and
errors, forms compose fields into payloads, validators run as functions or
effects, and wizards navigate between step forms.

## Documentation

- Guide: [movpushmov.dev/virentia/forms](https://movpushmov.dev/virentia/forms/)
- API reference: [movpushmov.dev/virentia/api/forms](https://movpushmov.dev/virentia/api/forms)

## Packages

- `@virentia/forms` - core fields, forms, validation, dynamic fields, wizards,
  and field contracts.
- `@virentia/forms-react` - React hooks for fields, forms, and wizards.
- `@virentia/forms-zod` - Zod validation adapter.

## Installation

```sh
pnpm add @virentia/forms @virentia/core
```

Optional integrations:

```sh
pnpm add @virentia/forms-react @virentia/react react
pnpm add @virentia/forms-zod zod
```

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

MIT © 2026 movpushmov
