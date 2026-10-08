# Spec Delta

## Purpose

Folder scans report their actual coverage and give users a direct recovery path when the configured traversal limit prevents the scanner from visiting deeper folders.

## ADDED Requirements

### Requirement: Depth-limited directories are counted separately
The system SHALL report directories skipped at the configured depth limit separately from directories that could not be read.

#### Scenario: A child directory is beyond the scan limit
- **WHEN** the scanner encounters a child directory at the maximum scan depth
- **THEN** the summary increments its depth-skip count and does not count the directory as a read failure

### Requirement: A depth-truncated scan is not complete
The system SHALL report a scan as partial when one or more child directories are skipped at the configured depth limit, while retaining every supported media file already discovered.

#### Scenario: Media exists below the depth limit
- **WHEN** a scan discovers supported media within the limit and skips a child directory beyond it
- **THEN** the scan reports partial status and keeps the media already discovered

#### Scenario: No media is found before a depth skip
- **WHEN** a scan skips a child directory at the depth limit without discovering supported media
- **THEN** the scan reports partial status instead of the empty-folder or complete status

### Requirement: Users can recover from depth truncation
The system SHALL show one accessible status toast with the actual number of depth-skipped directories, the instruction to select a deeper folder directly, and an action that opens folder selection.

#### Scenario: The scan reaches its depth limit
- **WHEN** a folder import skips one or more child directories at the depth limit
- **THEN** the user sees “Folder scan stopped at the six-level limit. Select a deeper folder directly to include its media.” and the actual skipped-directory count
- **AND** the toast offers a keyboard-operable action to choose a deeper folder

#### Scenario: The user scans the deeper folder
- **WHEN** the user chooses a skipped descendant as the new scan root
- **THEN** its supported media is added while previously imported media remains available and is not duplicated

### Requirement: Existing scan outcomes remain distinct
The system SHALL preserve the existing read-error retry, cancellation, empty-folder, and complete-scan outcomes when depth truncation does not occur.

#### Scenario: A branch read fails
- **WHEN** a folder read fails without depth truncation
- **THEN** the scan reports the read-failure count and retains the existing retry action

#### Scenario: A scan is canceled
- **WHEN** the user cancels a scan before it completes
- **THEN** the scan reports cancellation and retains media already discovered

#### Scenario: A scan completes without skipped folders
- **WHEN** the scan finishes without read failures or depth skips
- **THEN** the existing complete or empty-folder message is shown as appropriate
