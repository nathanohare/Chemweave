Fixed: Spreadsheet: on stacked column, bar and area charts, data labels and error bars sit at the end of each series' own piece of the stack, not partway down it.
Fixed: Spreadsheet: series names, category labels and data labels in charts are drawn as typed: an underscore or caret (run_1, NJ_023) no longer turns the next letter into a subscript or superscript. Titles still take k_{obs} and s^{-1}.
Fixed: Spreadsheet: a chart axis given the same minimum and maximum (or a maximum below the minimum) still shows its points and bars, on a widened range.
Fixed: Spreadsheet: Scatter with Lines joins the points in the order of the rows, as Excel does, so a loop such as a cyclic voltammogram is drawn as a loop.
Fixed: Spreadsheet: a bubble chart with a very long series draws instead of failing.
Fixed: Spreadsheet: a crowded Sankey column stays inside the chart; a decomposition tree keeps the expanded node (with its lines) when its column is cut short, never draws over its column titles, and a node with nothing under it no longer expands to an empty column.
Fixed: Document, Slides: a chart too big for a full-resolution picture for other programs gets a smaller picture instead of a blank one.
Fixed: Picture Format: Remove Background on a picture with a see-through background keeps black ink that touches it.
Changed: Picture Format: moving the Brightness, Contrast, Recolor and Transparency settings on a picture with Remove Background or sharpening is much quicker, sharpening and softening use far less memory, and large photos are worked out at screen size while shown.
Fixed: Picture Format: pages and slide strips with many pictures with effects no longer work every picture out again on each repaint.
Fixed: Design, Slides: a tall shape's reflection is no longer cut off in a straight line part way down, and the second half of a bracket pair is drawn in every part of the screen it reaches.
Fixed: Design, Slides: Soft Edges on a shape with no fill keeps its outline instead of hiding the shape; on a picture fill it fades the picture as it fades a color fill.
Fixed: Design, Slides: Shape Effects ▸ Glow presets are 60% transparent, as PowerPoint's Glow Variations are.
Fixed: Canvas: drawings are sharp at browser zooms such as 110% and 90%, with no faint seams every few inches.
Fixed: Canvas: long atom labels (and labels on structures scaled up) are no longer cut off at the edge of a part of the screen, or left behind after an edit.
Fixed: Canvas: a curved arrow bent more than half way round is drawn in full when scrolled.
Fixed: Canvas: the charge on a lone carbon (CH3+), or on a carbon with Show Carbon, can be picked up where it is drawn.
Fixed: Canvas: open arrowheads and box corners have the same sharp point wherever they are drawn, and a very short arrow's head no longer reaches back past its tail.
Fixed: Canvas: dot and line patterns on very large shapes spread out instead of disappearing.
Fixed: Document: the picture of an embedded workbook draws merged cells as one cell, and cuts text off at the first filled cell beside it.
Fixed: Pictures: SVG pictures come in at the size their width and height give, in millimeters, points or inches, instead of their drawing units.
Changed: Canvas, Slides: blurred shadows, dot and line patterns and highlight effects are worked out once rather than for every part of the screen they cross, so large drawings scroll and edit more smoothly.
Under the hood: tests for the rendering, chart and picture fixes from the November 2026 code review (batch 21).
