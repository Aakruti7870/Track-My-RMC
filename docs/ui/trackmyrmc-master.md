# TrackMyRMC master UI reference

The light and dark login images in [PR #225](https://github.com/Aakruti7870/Track-My-RMC/pull/225) are the approved 615-row hero crops. The checked-in hero PNGs match the uploads byte for byte, and the WebP variants preserve the decoded pixels. Theme tokens are in [tokens.ts](../../frontend/src/theme/tokens.ts), with screen-specific palette entries under `loginAppearance`.

## Hero and page

| Surface | Dark | Light |
| --- | --- | --- |
| Upper sky, left to right | #131925 → #151D2A → #4D586E | #97B3C9 → #A0BACD → #A8BED3 |
| Clouds and right-hand sky | #6A5157, #ECA383 | #DED5CE, #FDC99C |
| Brand panel and lower haze | #0C1218, #202731, #31343C | #11151A, #242831, #6A6B6F |
| TRACK MY / RMC / tagline | #FFFFFF / #FF7800 / #ACB3C0 | #FFFFFF / #FF8201 / #B6BEC9 |
| Wordmark divider | #E2731D → #824D2F | #ED7C11 → #8A5A34 |
| Cab / drum stripe / silos | #C9BBBA / #E95404 / #747480 | #CEC0BD / #F15A01 / #9B999E |
| Road reflection | #8F5937 | #A06434 |
| Road fade at y≈570 / 618 / 680 | #121318 / #0A0B10 / #08090E | #25262A / #898884 / #E9E4DE |
| Page beside and below the card | #08090E → #07080D → #06070C | #E9E4DE → #ECE7E1 → #F4F1EC |

Keep the hero uncropped, centered, and proportional. Continue the sampled last row behind the live login card. At the reference proportions, the card is about 55% of the artwork width, starts around y=619 and ends around y=1470. At narrow widths the card expands to maintain readable text and usable controls.

## Card and controls

| Surface | Dark | Light |
| --- | --- | --- |
| Login card | #0E0E0E–#151515, with #121212 in the middle and #111111 near the bottom | #F8F7F3–#FCFBF7, chiefly #FAF9F5 |
| Upper-left highlight | #D0A56E / #DC9C52 into #383129 | None |
| Top and side edge | #DCDCDC / #616161 / #404040 | #C9C4BE |
| Bottom edge and shadow | #7E7E7E over near-black | #C9C4BE edge with a soft neutral shadow |
| Tab rail and inactive Plant Staff fill | #0E0E0E–#131313, rim #363636–#535353 | #F0EDE6, rim #D9D6CF–#E0DDD8 |
| Selected tab fill | #603813 → #472D13 → #3A2611 | #E8970A → #C6790D → #B3650E |
| Selected tab rim | #9D6930 → #815530 | #2A2A2C around #AD6C24 → #CC7926 → #F68E2D |
| Phone circle | #472D13 | Same amber artwork as the selected tab |
| Phone prefix / field / rim / divider | #121212 / #171717–#1A1A1A / #3D3D3D–#5F5F5F / #414141 | #FCFCF8 / #FCFBF7 / #B5B2AD–#C4BFB9 / #D1CDCA |
| Empty Continue fill / rim | #252525–#262626 / #373737–#3E3E3E | #E9E6DF–#EAE7E0 / #DBD8D1–#DFDCD5 |
| Reviewer pill fill / rim | #141414–#181818 / #535353–#6B6B6B | #FBFAF6 / #BFBCB7–#CEC9C3 |

## Type, icons and links

| Element | Dark | Light |
| --- | --- | --- |
| Selected label / icon | #FFF0E2 / #D88A38 | #5D3719 / #BB8356 |
| Inactive label / icon | #C1C1C1 / #B2B2B2 | #504D47 / #5B5853 |
| Phone icon | #E29531 | #AE7947 |
| Welcome heading / subtitle | #FEFEFE / #E1E1E1 | #0A0907 / #3C3C39 |
| +91 / placeholder | #F1F1F1 / #E4E4E4 | #0B0B0A / #343331 |
| Empty Continue text / shield | #A1A1A1 / #B9B9B9 | #65625B / #67645D |
| OTP copy / lock | #A0A0A0 / #999999 | #41403E / #51504E |
| Reviewer label / shield | #F2F2F2 / #3DA07F | #121211 / #327A61 |
| Consent copy | #DDDDDD | #3C3B39 |
| Terms / Privacy links, underlined | #C48B49 / #C38644 | #9C623C / #A16136 |
| Delete label / trash icon | #C8B4B5 / #D4B2B8 | #8D4852 / #954250 |
| Powered by / bold wordmark | #A0A0A0 / #F6F6F6 | #42403E / #121210 |

The screenshots show User Login selected with an empty field. Plant Staff selected, its form states and enabled Continue use their existing interaction rules and the same theme palette. Screenshots show the visible finish. The gradients and shadow in code approximate the sampled appearance.

## Shared app artwork

Light-mode colored icon tiles use a charcoal rim (#2A2A2C), a copper border (#AD6C24 → #CC7926 → #F68E2D), a narrow right-edge glow (#F98F2D → #FF9833), an amber fill (#E8970A → #C6790D → #B3650E at 0%, 50%, and 100%), and #FEF8EF glyphs. This covers the colored Home shortcuts, the Bulk Enquiry and KYC icon tiles, login tabs and heading icons, and Super Admin module tiles. Selected login tab text uses graphite for contrast in light mode. Shared card highlights blend #D0A56E and #DC9C52 into #383129 in dark mode only. Dark-mode Quick Access and selected login tabs use a copper rim (#9D6930 → #815530), an amber-brown fill (#603813 → #472D13 → #3A2611), and #FFF0E2 glyphs. Bulk enquiry uses #452D15 → #483019 with a green icon tile at 70% opacity in dark mode. KYC retains its status text and surface colors. Home content scrolls in one flow, including the hero and Quick Access. Verified KYC, Enable Location and the Plant Profile tint use green. Order stages use red for Pending, blue for Accepted, yellow for Preparing, green for Dispatched and orange for Delivered. Keep the text labels visible with the color cues.

The shared artwork comes from [PR #222](https://github.com/Aakruti7870/Track-My-RMC/pull/222). The Customer Home carousel uses the six uploaded banners from [PR #223](https://github.com/Aakruti7870/Track-My-RMC/pull/223).
