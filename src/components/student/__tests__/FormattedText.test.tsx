import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { FormattedText } from '../FormattedText';

describe('FormattedText paragraph structure', () => {
  it.each([false, true])(
    'marks question copy when highlightEnabled=%s',
    (highlightEnabled) => {
      const { container } = render(
        <FormattedText
          as="span"
          text="Question copy"
          highlightEnabled={highlightEnabled}
          suppressTouchCallout
        />,
      );

      const copy = container.firstElementChild as HTMLElement;
      expect(copy).toHaveAttribute('data-student-question-callout-protected', 'true');
      if (highlightEnabled) {
        expect(copy.style.userSelect).toBe('text');
      }
    },
  );

  it('renders single-paragraph text without extra <p> wrappers', () => {
    const { container } = render(
      <FormattedText as="div" text="Hello world" />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.textContent).toBe('Hello world');
  });

  it('renders \\n\\n-separated text as separate <p> block elements so selection is scoped per paragraph', () => {
    const { container } = render(
      <FormattedText
        as="div"
        text={"First paragraph.\n\nSecond paragraph."}
        highlightEnabled
        highlightColor="yellow"
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.tagName).toBe('DIV');

    const paragraphs = wrapper.querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0]?.textContent).toContain('First paragraph');
    expect(paragraphs[1]?.textContent).toContain('Second paragraph');
  });

  it('renders three \\n\\n-separated paragraphs as three <p> blocks', () => {
    const { container } = render(
      <FormattedText
        as="div"
        text={"Alpha.\n\nBeta.\n\nGamma."}
        highlightEnabled
        highlightColor="yellow"
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    const paragraphs = wrapper.querySelectorAll('p');
    expect(paragraphs.length).toBe(3);
  });

  it('preserves bold markers inside paragraph-split text', () => {
    const { container } = render(
      <FormattedText
        as="div"
        text={"First **bold word** here.\n\nSecond paragraph."}
        highlightEnabled
        highlightColor="yellow"
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    const strongTags = wrapper.querySelectorAll('strong');
    expect(strongTags.length).toBe(1);
    expect(strongTags[0]?.textContent).toBe('bold word');
  });

  it('does not split into <p> blocks when as="span" (inline context)', () => {
    const { container } = render(
      <FormattedText as="span" text={"Alpha.\n\nBeta."} />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');
    const paragraphs = wrapper.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  it('renders non-highlighted multi-paragraph text with <p> block elements', () => {
    const { container } = render(
      <FormattedText as="div" text={"First paragraph.\n\nSecond paragraph."} />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    const paragraphs = wrapper.querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  });
});
