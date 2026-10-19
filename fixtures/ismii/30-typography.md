# Typography

## The four faces

| Face | Role |
| --- | --- |
| **Cormorant Garamond 600** | The ISMII acronym and display headings. A high-contrast Garamond with the calm of a printed title page |
| **Libre Franklin** | The default: body text, interface, labels, captions and the name in the lockup |
| **Spectral** | Pull-quotes and epigraphs, usually in italic |
| **IBM Plex Mono** | Folios, catalogue and accession numbers, dates in archival listings. Nothing else |

All four are open-source Google Fonts. *Brand pack.*

## Scale

*Proposed.* The token styles define a working scale:

| Style | Face | Size / leading | Use |
| --- | --- | --- | --- |
| `display-xl` | Cormorant 600 | 72 / 76 | Film titles, covers, event backdrops |
| `display` | Cormorant 600 | 48 / 54 | Page titles, lecture titles on posts |
| `heading` | Cormorant 600 | 32 / 38 | Section heads |
| `subheading` | Libre Franklin 600 | 20 / 28 | Subsections, card titles |
| `body-lg` | Libre Franklin 400 | 18 / 30 | Long-form reading on the web |
| `body` | Libre Franklin 400 | 16 / 26 | Default text |
| `label` | Libre Franklin 600 | 12 / 16 | Capitals, tracked 0.12em: eyebrows, the affiliation line, event labels |
| `caption` | Libre Franklin 400 | 13 / 18 | Captions, credits, sources |
| `pull-quote` | Spectral italic 400 | 24 / 34 | Quotations |
| `folio` | IBM Plex Mono 400 | 12 / 16 | Page numbers, catalogue numbers |

## Setting rules

- Headings in Cormorant run in sentence case. Capitals are reserved for the acronym and for Libre Franklin labels.
- Never set Cormorant below 20px; its fine hairlines break up on screen.
- Keep measure between 60 and 75 characters for reading text.
- Transliterated names keep their diacritics where the source uses them (Shāh Walīullāh); both text faces support the extended Latin set.
- Use commas, colons, semicolons or full stops rather than the em dash.

## Urdu and Devanagari

*Proposed, to confirm.* ISMII publishes across scripts. Recommended companions, chosen for weight and colour against the Latin faces:

- **Urdu:** Noto Nastaliq Urdu for display and titles; Noto Naskh Arabic where a Naskh setting reads better at small sizes.
- **Hindi and Hindustani in Devanagari:** Noto Serif Devanagari beside Cormorant headings; Noto Sans Devanagari beside Libre Franklin text.

Set Nastaliq with extra leading (about 1.8 to 2.0) so its descending strokes clear the next line.
