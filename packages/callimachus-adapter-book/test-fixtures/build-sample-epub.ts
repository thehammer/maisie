/**
 * Generates test-fixtures/sample.epub from sample.txt content.
 * Run once manually: bun test-fixtures/build-sample-epub.ts
 * The output is committed so tests don't need to re-run this script.
 */

import makeEpub from 'epub-gen-memory'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const dir = import.meta.dir

const chapters = [
  {
    title: 'Chapter 1: Arrival',
    content: `
<p>The transport skimmed low over the grey ocean, banking hard as it approached the island facility. Vance pressed her face against the cold viewport, watching the whitecapped waves blur beneath them.</p>
<p>"First time off-planet?" said the man beside her. He wore a faded investigator's coat, collar turned up against the recycled air.</p>
<p>She shook her head. "Third. But first time coming here voluntarily."</p>
<p>The man smiled thinly. He hadn't introduced himself yet, but she'd seen his name on the mission brief: Marit. Formerly attached to the Ordinate's intelligence division, currently listed as detached.</p>
<p>"Voluntary is a matter of perspective," Marit said, and turned back to the window.</p>
<p>The facility sprawled across the cliffside like something grown rather than built. Vance could make out a dozen distinct wings, each joined by covered walkways that swayed in the coastal wind.</p>
<hr/>
<p>Processing took two hours. Vance submitted to the biometric scan, the retinal log, and the psychological index without complaint. Marit went through the same procedure in the adjacent booth, his answers clipped and practiced.</p>
<p>When they emerged into the main atrium, a young aide was waiting with a data-slate and an expression of bureaucratic exhaustion.</p>
<p>"You've been assigned to the eastern annex," the aide said. "Meals are at six, twelve, and nineteen hundred. The archive is locked between zero-two and six hundred."</p>
<p>"What about the lower levels?" Vance asked.</p>
<p>The aide's expression didn't change. "Those are not part of your assignment."</p>
<p>She made a note of it anyway.</p>
`,
  },
  {
    title: 'Chapter 2: Inquiry',
    content: `
<p>The archive occupied the entirety of the third sublevel. Vance had requisitioned access that morning, presenting the authorisation codes from the mission brief. The desk officer had checked them twice, then a third time, before finally buzzing her through.</p>
<p>Marit was already inside, bent over a reader station in the far corner.</p>
<p>"How did you get in?" she asked.</p>
<p>He looked up. "Politely."</p>
<p>The archive was organised by incident classification rather than date, which meant that finding the relevant files required navigating a taxonomy that seemed to have been designed to discourage exactly the kind of search Vance was conducting. She worked methodically, starting with the broadest category and narrowing down.</p>
<hr/>
<p>By the third hour, she had assembled a partial picture. The facility had been commissioned as a research outpost. Standard function: environmental monitoring, geological survey, some signals work. But eighteen months ago, the signals work had abruptly ceased, replaced by a new classification that Vance didn't recognise.</p>
<p>She flagged the classification and brought it to Marit.</p>
<p>He looked at it for a long moment. "That's a containment designation," he said quietly.</p>
<p>"What were they containing?"</p>
<p>"That's the question, isn't it."</p>
`,
  },
  {
    title: 'Chapter 3: Confrontation',
    content: `
<p>The boat was small and fast, a repurposed survey skiff that Marit had apparently arranged the previous evening. Vance didn't ask how. The sea was rough, the horizon a flat grey line that was indistinguishable from the sky.</p>
<p>"You've been here before," she said, over the engine noise. Not a question this time.</p>
<p>Marit kept his eyes on the navigation display. "Once. A long time ago. Under different circumstances."</p>
<p>"Different how?"</p>
<p>"I was on the other side of the investigation."</p>
<p>Vance absorbed this. She'd suspected something like it, but the confirmation changed the texture of things. She recalibrated her estimation of the risk they were running.</p>
<hr/>
<p>The secondary facility was smaller than the main complex, half-submerged into the rock of a sea stack that rose from the water like a broken tooth. There was a single dock, unmanned when they arrived.</p>
<p>Inside, the corridors were lit by emergency strips. In the central chamber, arranged with a precision that suggested deliberate placement rather than abandonment, were seven data cores. Each was labelled with the same classification she'd seen in the archive.</p>
<p>"They were never destroyed," Marit said.</p>
<p>"No." She crouched beside the nearest core. "They were waiting."</p>
`,
  },
]

const buffer = await makeEpub(
  { title: 'Sample', author: 'Test Fixture' },
  chapters,
)

const outPath = join(dir, 'sample.epub')
await writeFile(outPath, buffer)
console.log(`Written: ${outPath} (${buffer.length} bytes)`)
