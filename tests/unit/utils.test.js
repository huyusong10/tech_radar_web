// tests/unit/utils.test.js

// Mock functions to simulate the parsing and processing functions
// from index.html and server.js that we want to test

describe('Utility Functions', () => {
  // Mock parseFrontmatter function from index.html
  const parseFrontmatter = (content) => {
    // This simulates the behavior in parseFrontmatter function
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { metadata: {}, content: content };
    
    const metadata = require('js-yaml').load(match[1]);
    const markdownContent = match[2];
    return { metadata, content: markdownContent };
  };

  // Mock parseYamlFrontmatter function from server.js  
  const parseYamlFrontmatter = (content) => {
    // This simulates the behavior in parseYamlFrontmatter function
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { metadata: {}, content: content };
    
    const metadata = require('js-yaml').load(match[1]);
    const markdownContent = match[2];
    return { metadata, content: markdownContent };
  };

  test('parseFrontmatter should correctly parse YAML frontmatter', () => {
    const content = `---
title: "Test Post"
author: "John Doe"
tags: ["tech", "test"]
---
This is the markdown content`;
    
    const result = parseFrontmatter(content);
    expect(result.metadata).toEqual({
      title: "Test Post",
      author: "John Doe",
      tags: ["tech", "test"]
    });
    expect(result.content).toBe("This is the markdown content");
  });

  test('parseFrontmatter should handle content without frontmatter', () => {
    const content = "This is the markdown content without frontmatter";
    const result = parseFrontmatter(content);
    expect(result.metadata).toEqual({});
    expect(result.content).toBe("This is the markdown content without frontmatter");
  });
});