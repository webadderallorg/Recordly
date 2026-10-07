import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry";

interface MockProvider {
	id: string;
	name: string;
}

describe("ProviderRegistry", () => {
	it("registers and retrieves a provider by ID", () => {
		const registry = new ProviderRegistry<MockProvider>();
		const provider = { id: "test", name: "Test Provider" };
		registry.register(provider);
		expect(registry.get("test")).toBe(provider);
	});

	it("returns undefined for an unknown ID", () => {
		const registry = new ProviderRegistry<MockProvider>();
		expect(registry.get("nonexistent")).toBeUndefined();
	});

	it("lists all registered providers in insertion order", () => {
		const registry = new ProviderRegistry<MockProvider>();
		const a = { id: "a", name: "A" };
		const b = { id: "b", name: "B" };
		registry.register(a);
		registry.register(b);
		expect(registry.list()).toEqual([a, b]);
	});

	it("overwrites a provider when re-registering with the same ID", () => {
		const registry = new ProviderRegistry<MockProvider>();
		const original = { id: "test", name: "Original" };
		const replacement = { id: "test", name: "Replacement" };
		registry.register(original);
		registry.register(replacement);
		expect(registry.get("test")).toBe(replacement);
		expect(registry.list()).toHaveLength(1);
	});

	it("reports whether a provider ID is registered", () => {
		const registry = new ProviderRegistry<MockProvider>();
		registry.register({ id: "registered", name: "Reg" });
		expect(registry.has("registered")).toBe(true);
		expect(registry.has("missing")).toBe(false);
	});

	it("starts empty", () => {
		const registry = new ProviderRegistry<MockProvider>();
		expect(registry.list()).toEqual([]);
		expect(registry.has("anything")).toBe(false);
	});
});
