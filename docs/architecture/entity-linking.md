# Entity Linking Model

Harbor should support linking entities together through typed relationships.

## Examples
- file to file: related, duplicate candidate, alternate version, derived from
- file to folder/event: belongs to event, featured in collection
- folder to folder: same trip, same project, continuation

## Design recommendation
Use a generic relation table with:
- relation id
- source entity type
- source entity id
- target entity type
- target entity id
- relation type
- directionality
- confidence/source
- created by
- created at
- notes
