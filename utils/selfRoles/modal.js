const { ModalBuilder, LabelBuilder, CheckboxGroupBuilder } = require("discord.js");

const LABEL_LIMIT = 45;
const OPTION_TEXT_LIMIT = 100;

function groupFieldId(index) {
  return `group:${index}`;
}

// Both overrides matter: the API defaults (min 1, required) would stop anyone unchecking a group's last role.
function buildRolesModal(modalId, groups, roleNames, heldIds) {
  const modal = new ModalBuilder().setCustomId(modalId).setTitle("Your Roles");

  groups.forEach((group, index) => {
    const options = group.entries.map(entry => {
      const option = {
        label: (roleNames.get(entry.roleId) || entry.roleId).slice(0, OPTION_TEXT_LIMIT),
        value: entry.roleId,
        default: heldIds.has(entry.roleId),
      };
      if (entry.description) option.description = entry.description.slice(0, OPTION_TEXT_LIMIT);
      return option;
    });

    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel(group.label.slice(0, LABEL_LIMIT))
        .setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId(groupFieldId(index))
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(options.length)
            .addOptions(...options)
        )
    );
  });

  return modal;
}

// A group with nothing checked may be absent from the payload, and getCheckboxGroup throws on a missing field.
function readSubmittedRoleIds(submit, groupCount) {
  const ids = [];
  for (let i = 0; i < groupCount; i++) {
    const values = submit.fields.fields.get(groupFieldId(i))?.values;
    if (Array.isArray(values)) ids.push(...values);
  }
  return ids;
}

module.exports = { LABEL_LIMIT, OPTION_TEXT_LIMIT, groupFieldId, buildRolesModal, readSubmittedRoleIds };
