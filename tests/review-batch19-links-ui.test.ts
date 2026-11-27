// @vitest-environment jsdom
//
// Review batch 19, Edit Link (F734): a mailto: link with other fields than a subject first (cc, body)
// opened with an empty address, took "Hi&body=Text" for the subject and lost the body on OK, and a
// stray % in the address stopped the window opening.
//
// The form of a mailto: link is RFC 6068 section 2: mailto:<to>?<hfname>=<hfvalue>&<hfname>=<hfvalue>.

import { describe, expect, it } from 'vitest';
import { askLink, mailFields, mailLink } from '../src/ui/links-ui';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

describe('F734: reading and writing a mailto link', () => {
  it('reads the address, the subject and the other fields in order', () => {
    expect(mailFields('mailto:a@b.org?cc=c@d.org&subject=Hi')).toEqual({ address: 'a@b.org', subject: 'Hi', fields: ['cc=c@d.org', null] });
    expect(mailFields('mailto:a@b.org?subject=Hi&body=Text')).toEqual({ address: 'a@b.org', subject: 'Hi', fields: [null, 'body=Text'] });
    expect(mailFields('mailto:a@b.org')).toEqual({ address: 'a@b.org', subject: '', fields: [] });
    expect(mailFields('mailto:a@b.org?cc=c@d.org')).toEqual({ address: 'a@b.org', subject: '', fields: ['cc=c@d.org'] });
  });
  it('reads %-escapes in the address and subject, and a stray % as it stands', () => {
    expect(mailFields('mailto:a%40b.org?subject=Yield%20of%204a')).toMatchObject({ address: 'a@b.org', subject: 'Yield of 4a' });
    expect(mailFields('mailto:100%@b.org?subject=50%')).toMatchObject({ address: '100%@b.org', subject: '50%' });
  });
  it('writes the subject back where it was and keeps the other fields', () => {
    const m = mailFields('mailto:a@b.org?cc=c@d.org&subject=Hi&body=Text');
    expect(mailLink('mailto:a@b.org', 'Hi there', m.fields)).toBe('mailto:a@b.org?cc=c@d.org&subject=Hi%20there&body=Text');
    expect(mailLink('mailto:a@b.org', '', m.fields)).toBe('mailto:a@b.org?cc=c@d.org&body=Text'); // subject cleared
    expect(mailLink('mailto:a@b.org', 'New', [])).toBe('mailto:a@b.org?subject=New');
    expect(mailLink('mailto:a@b.org', 'New', ['cc=c@d.org'])).toBe('mailto:a@b.org?subject=New&cc=c@d.org');
    expect(mailLink('mailto:a@b.org', '', [])).toBe('mailto:a@b.org');
  });
});

describe('F734: the Edit Link window with such links', () => {
  const open = (link: string) => {
    document.body.replaceChildren();
    const got = askLink({ link, text: 'write' });
    const d = document.querySelector<HTMLDialogElement>('dialog.link-dialog')!;
    const inputs = [...d.querySelectorAll<HTMLInputElement>('input')];
    const mail = inputs.find((i) => i.type === 'email')!;
    const subject = inputs[inputs.indexOf(mail) + 1];
    const ok = () => d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return { got, mail, subject, ok };
  };
  it('shows the address when another field comes before the subject, and keeps all on OK', async () => {
    const { got, mail, subject, ok } = open('mailto:a@b.org?cc=c@d.org&subject=Hi');
    expect(mail.value).toBe('a@b.org');
    expect(subject.value).toBe('Hi');
    ok();
    expect(await got).toEqual({ link: 'mailto:a@b.org?cc=c@d.org&subject=Hi', text: 'write' });
  });
  it('does not put the body in the subject', async () => {
    const { got, subject, ok } = open('mailto:a@b.org?subject=Hi&body=Text');
    expect(subject.value).toBe('Hi');
    ok();
    expect((await got)).toMatchObject({ link: 'mailto:a@b.org?subject=Hi&body=Text' });
  });
  it('opens for an address with a stray %', async () => {
    const { got, mail, ok } = open('mailto:100%@b.org');
    expect(mail.value).toBe('100%@b.org');
    ok();
    expect(await got).toMatchObject({ link: 'mailto:100%@b.org' });
  });
});
