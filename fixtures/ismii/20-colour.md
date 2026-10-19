# Colour

## Palette

| Colour | Hex | RGB | Role |
| --- | --- | --- | --- |
| Sandstone Red | `#9E3D22` | 158 61 34 | Primary. The only colour that carries the mark |
| Marble Ivory | `#F4EFE6` | 244 239 230 | Primary ground |
| Warm Marble | `#EDE6D8` | 237 230 216 | Alternate ground, panels, quiet sections |
| India Ink | `#1C1B19` | 28 27 25 | Text; the dark ground |
| Muted Sand | `#CFC7B6` | 207 199 182 | Body text on dark grounds |
| Rosette Gold | `#C87800` | 200 120 0 | Rules and seals only |
| Deep Gold | `#A85F00` | 168 95 0 | Gold on ivory grounds |
| Deccani Teal | `#0E5A52` | 14 90 82 | Secondary. Fields, section grounds, data |

*Brand pack.*

## Proportion

*Proposed.* A typical surface is mostly marble (about 60 percent), with ink for text (about 25 percent), Sandstone Red for the signature and one strong field or accent (about 10 percent), and gold and teal together in the remaining 5 percent. Sandstone can take a whole surface (a post frame, a cover) when it is the only strong colour on it.

## Legibility

Contrast ratios, measured against WCAG 2.1. Body text needs 4.5:1; text 24px and larger needs 3:1.

| Text on ground | Ratio | Use |
| --- | --- | --- |
| India Ink on Marble Ivory | 15.0 | All text |
| India Ink on Warm Marble | 13.9 | All text |
| Marble Ivory on India Ink | 15.0 | All text |
| Muted Sand on India Ink | 10.2 | All text; the default body colour on dark |
| Deccani Teal on Marble Ivory | 7.0 | All text, including links |
| Marble Ivory on Deccani Teal | 7.0 | All text |
| Sandstone Red on Marble Ivory | 5.8 | All text; headings and the acronym |
| Marble Ivory on Sandstone Red | 5.8 | All text |
| Rosette Gold on India Ink | 5.0 | Rules and seals only, by rule |
| Deep Gold on Marble Ivory | 4.3 | Rules, and display text 24px and up only |
| Muted Sand on Sandstone Red | 4.0 | Display text 24px and up only |
| Rosette Gold on Marble Ivory | 3.0 | Rules only |
| Sandstone Red on India Ink | 2.6 | Never text. The reversed lockup turns the mark ivory for this reason |

## Themes

The tokens define two themes. **Ivory** is the default: `ground` is Marble Ivory, `text` is India Ink, `brand` is Sandstone Red and `rule` is Deep Gold. **Ink** is the dark theme: `ground` is India Ink, `text` is Marble Ivory, `text-body` is Muted Sand, `brand` turns ivory (as in the reversed lockup) and `rule` becomes Rosette Gold.
