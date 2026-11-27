Fixed: Slides: exporting or copying a canvas slide, or a slide from a PowerPoint template whose slide size was changed, as a PDF, SVG or picture no longer fails.
Fixed: Document and Slides: pictures flipped with Arrange ▸ Flip stay flipped in SVG pictures, printing and template thumbnails.
Fixed: File ▸ Export ▸ Export Picture as EMF keeps photos and other pictures, cropped, turned, flipped and rounded as they show, at up to 300 dpi, instead of leaving them out; a picture that can't be read is named in the message after saving.
Fixed: Copy and paste: on Windows, photos and other pictures in a copied drawing now come along when it is pasted into Word or PowerPoint, and the picture kept with a structure saved as a ChemDraw object in a Word or PowerPoint file shows them too.
Fixed: Copy and paste: text with No fill and an outline stays hollow in the EMF picture Word and PowerPoint paste, and in EPS files, instead of coming out as solid letters.
Fixed: Export Picture as EPS keeps a picture's rotation, flip and rounded corners.
Fixed: Export ▸ PDF keeps see-through text colors and the rounded corners of pictures, and no longer fails on a link address with a broken character in it.
Fixed: SI Project: the live preview of a project with more than 40 PDF spectra no longer draws every PDF again after each change.
Fixed: SI Project: a PDF with one page that can't be drawn still shows its other pages; the page that failed keeps its place (so the pages after it keep their numbers and settings), is marked by a box in the compiled SI and named in the notes, and is tried again next time. A spectrum PDF that failed to load once is tried again too.
Fixed: Inserting a large-format PDF (a poster) as an object shows its first page instead of a blank picture.
Fixed: Pasted and opened EMF pictures: see-through bitmaps, cropped bitmaps, centered and right-aligned text, outlined text, clip regions and shapes with no outline now show as in the program that made them, and text in a font whose name has an apostrophe keeps its font.
Fixed: Export Picture as TIFF: every strip ends in a way strict TIFF readers accept.
Fixed: Opening a ChemDraw file with a damaged picture inside shows the picture's other copy instead of failing.
Under the hood: Long PDF attachments free each page's memory as soon as its picture is taken, and EMF+ clipping records are read by their published numbers.
