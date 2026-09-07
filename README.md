# Canvas Connect Review

Create an interactive prototype for an ontology review experience.

The core idea is CANVAS-FIRST.

Users are reviewing an AI-generated ontology against real datasets.

The main workspace should be an ontology canvas, not a dashboard.

Show:

- Entity Types

- Properties nested under entities

- Relationships between entities

- Data tables/datasets connected to ontology objects

- Mapping between properties and data columns

Use a small realistic dataset with:

- Customer

- Order

- Product

- Supplier

Example mappings:

Customer → customers table

Customer.email → customers.email

Customer.name → customers.first_name + customers.last_name

Customer.address → customers.address and customer_profile.address

Order → orders table

Explore these user behaviors:

1. SCAN

Users first look at the ontology as a whole and understand how entities and relationships are structured.

2. IDENTIFY SOMETHING SUSPICIOUS

Some ontology items should visibly need review.

For example:

- Customer.address may be questionable

- One relationship may look suspicious

- Some properties may have low-confidence mappings

3. INVESTIGATE

When users select an Entity, Property, or Relationship, show its relevant data connection.

Users should be able to see:

- source table

- source column(s)

- schema

- sample data

Do not show all data by default. Reveal relevant data when the user investigates an item.

4. COMPARE ONTOLOGY AND DATA

Make it easy to understand the connection between:

Entity → Table

Property → Column(s)

Relationship → supporting columns/tables

Support 1:N mappings and mappings across multiple tables.

5. EDIT THE ONTOLOGY

Explore direct canvas interactions:

- Move a Property from one Entity to another

- Edit an Entity

- Edit a Property

- Edit a Relationship

- Create a new Property

- Create a new Entity or Relationship

Example:

Move "address" from Customer to Order.

6. REVIEW SCOPE

Include a confidence threshold control.

Changing the threshold should visually change which ontology items are emphasized for review:

- Above threshold = normal/emphasized

- Below threshold = visually de-emphasized but still visible

Also show a compact review progress indicator such as:

Entities: 2 remaining

Properties: 5 remaining

Relationships: 1 remaining

Clicking a category should highlight the remaining items on the canvas.

IMPORTANT:

Do not focus on final Accept/Decline workflows yet.

Do not focus on detailed panel design.

Do not create a dashboard-heavy interface.

The goal is to explore how a CANVAS-FIRST ontology review experience could work.

Prioritize:

1. Canvas as the primary workspace

2. Ontology + data connections

3. Discovering suspicious items

4. Investigating real data

5. Editing the ontology directly on the canvas

Make the prototype interactive enough to explore these behaviors.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://canvas-ontology-insight.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0869c2c2-291c-4e32-b0b8-e4413c876a5c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
